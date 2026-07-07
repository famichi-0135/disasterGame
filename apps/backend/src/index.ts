import { DurableObject } from "cloudflare:workers";
import {
    createInitialGameState,
    normalizeGameState,
    toMatchView,
    transition,
    type Faction,
    type GameAction,
    type GameState,
    type Lane,
    type MatchView,
} from "@disaster-game/game-core";
import { Hono } from "hono";
import { cors } from "hono/cors";

type PlayerRole = Faction;
type ClientAction =
    | { type: "charge"; instanceId: string }
    | { type: "play"; instanceId: string; lane?: Lane }
    | { type: "pass" };

type MatchSnapshot = {
    role: PlayerRole;
    view: MatchView;
};

type StateRow = { payload: string };
type SeatRow = { role: PlayerRole; token_hash: string };
type TicketRow = { role: PlayerRole; expires_at: number };
type DisconnectRow = { role: PlayerRole; expires_at: number };
type SocketAttachment = { role: PlayerRole };
type DirectoryRow = { match_id: string; created_at: number; vacancies: number };
type MatchDirectoryStatus = "waiting" | "active" | "ended";

const SOCKET_TICKET_TTL_MS = 60_000;
const WAITING_ROOM_TTL_MS = 15 * 60_000;
const ACTIVE_ROOM_TTL_MS = 30 * 60_000;
const ENDED_ROOM_TTL_MS = 5 * 60_000;
const RECONNECT_GRACE_MS = 30_000;

export class GameMatch extends DurableObject<CloudflareBindings> {
    constructor(ctx: DurableObjectState, env: CloudflareBindings) {
        super(ctx, env);
        ctx.blockConcurrencyWhile(async () => {
            this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS game_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL
        );
      `);
            this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS seats (
          role TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE
        );
      `);
            this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS socket_tickets (
          ticket TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
            this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS seat_disconnects (
          role TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );
      `);
        });
    }

    async create(playerToken: string): Promise<MatchSnapshot> {
        if (this.readState())
            throw new Error("この対戦ルームはすでに作成されています。");

        const tokenHash = await hashToken(playerToken);
        const state = this.writeState(createInitialGameState());
        this.ctx.storage.sql.exec(
            "INSERT INTO seats (role, token_hash) VALUES (?, ?)",
            "dark",
            tokenHash,
        );
        await this.scheduleExpiry(state);
        return this.snapshot(state, "dark");
    }

    async join(playerToken: string): Promise<MatchSnapshot> {
        const tokenHash = await hashToken(playerToken);
        let state = this.requireState();
        state = await this.releaseExpiredSeats(state);
        const existingRole = this.roleForTokenHash(tokenHash);
        if (existingRole) return this.snapshot(state, existingRole);

        if (state.phase === "ended")
            throw new Error("終了した対戦ルームには参加できません。");

        const role = this.openRole();
        if (!role) throw new Error("この対戦ルームは満員です。");

        this.ctx.storage.sql.exec(
            "INSERT INTO seats (role, token_hash) VALUES (?, ?)",
            role,
            tokenHash,
        );
        this.clearDisconnectDeadline(role);
        await this.syncDirectory(state);
        await this.scheduleExpiry(state);
        this.broadcast(state);
        return this.snapshot(state, role);
    }

    async getState(playerToken: string): Promise<MatchSnapshot> {
        const role = await this.requireRole(playerToken);
        const state = this.requireState();
        await this.scheduleExpiry(state);
        return this.snapshot(state, role);
    }

    async act(
        playerToken: string,
        action: ClientAction,
    ): Promise<MatchSnapshot> {
        const role = await this.requireRole(playerToken);
        const state = this.requireState();
        const actionResult = transition(state, this.toGameAction(role, action));
        if (!actionResult.ok) throw new Error(actionResult.error);

        // 判定はプレイヤーに委ねず、政府のプレイ/パス直後にサーバーが確定する。
        const resolvedResult =
            actionResult.state.phase === "resolution"
                ? transition(actionResult.state, { type: "resolve" })
                : actionResult;
        if (!resolvedResult.ok) throw new Error(resolvedResult.error);

        const persisted = this.writeState(resolvedResult.state);
        await this.syncDirectory(persisted);
        await this.scheduleExpiry(persisted);
        this.broadcast(persisted);
        return this.snapshot(persisted, role);
    }

    async issueSocketTicket(playerToken: string): Promise<{ ticket: string }> {
        const role = await this.requireRole(playerToken);
        const now = Date.now();
        const ticket = crypto.randomUUID();
        this.ctx.storage.sql.exec(
            "DELETE FROM socket_tickets WHERE expires_at <= ?",
            now,
        );
        this.ctx.storage.sql.exec(
            "INSERT INTO socket_tickets (ticket, role, expires_at) VALUES (?, ?, ?)",
            ticket,
            role,
            now + SOCKET_TICKET_TTL_MS,
        );
        await this.scheduleExpiry(this.requireState());
        return { ticket };
    }

    async leave(playerToken: string): Promise<void> {
        const role = await this.requireRole(playerToken);
        this.closeSocketsForRole(role);
        const state = this.removeSeat(role);
        await this.applyVacancies(state);
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (
            url.pathname !== "/socket" ||
            request.headers.get("Upgrade") !== "websocket"
        ) {
            return new Response("Not found", { status: 404 });
        }

        const ticket = url.searchParams.get("ticket");
        if (!ticket)
            return new Response("Missing socket ticket", { status: 401 });

        const role = this.consumeSocketTicket(ticket);
        if (!role) return new Response("Unauthorized", { status: 401 });

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role } satisfies SocketAttachment);
        const state = this.requireState();
        this.clearDisconnectDeadline(role);
        await this.scheduleExpiry(state);
        this.sendState(server, state, role);
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(webSocket: WebSocket): Promise<void> {
        const attachment =
            webSocket.deserializeAttachment() as SocketAttachment | null;
        if (!attachment || !isPlayerRole(attachment.role)) {
            webSocket.close(1008, "Unauthorized");
            return;
        }
        this.sendState(webSocket, this.requireState(), attachment.role);
    }

    async webSocketClose(webSocket: WebSocket): Promise<void> {
        this.markDisconnected(webSocket);
        const state = this.readState();
        if (state) await this.scheduleExpiry(state);
    }

    async webSocketError(webSocket: WebSocket): Promise<void> {
        this.markDisconnected(webSocket);
        const state = this.readState();
        if (state) await this.scheduleExpiry(state);
    }

    async alarm(): Promise<void> {
        const state = this.readState();
        if (!state) return;

        const earliestDisconnect = this.nextDisconnectDeadline();
        if (earliestDisconnect && earliestDisconnect <= Date.now()) {
            await this.releaseExpiredSeats(state);
            return;
        }

        const pendingDisconnect = this.nextDisconnectDeadline();
        if (pendingDisconnect && pendingDisconnect > Date.now()) {
            await this.scheduleExpiry(state);
            return;
        }

        if (this.hasConnectedSockets()) {
            await this.scheduleExpiry(state);
            return;
        }

        const matchId = this.matchId();
        if (matchId) {
            await this.env.MATCH_DIRECTORY.prepare(
                "DELETE FROM match_directory WHERE match_id = ?",
            )
                .bind(matchId)
                .run();
        }

        // compatibility_date が 2026-02-24 以降のため、アラームも同時に消える。
        await this.ctx.storage.deleteAll();
    }

    private readState(): GameState | undefined {
        const row = this.ctx.storage.sql
            .exec<StateRow>("SELECT payload FROM game_state WHERE id = 1")
            .toArray()[0];
        if (!row) return undefined;
        return normalizeGameState(JSON.parse(row.payload));
    }

    private requireState(): GameState {
        const state = this.readState();
        if (!state) throw new Error("対戦ルームが見つかりません。");
        return state;
    }

    private writeState(state: GameState): GameState {
        const revision =
            Math.max(this.readState()?.revision ?? 0, state.revision) + 1;
        const persisted = { ...state, revision };
        this.ctx.storage.sql.exec(
            "INSERT INTO game_state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
            JSON.stringify(persisted),
        );
        return persisted;
    }

    private hasSeat(role: PlayerRole): boolean {
        return Boolean(
            this.ctx.storage.sql
                .exec<SeatRow>(
                    "SELECT role, token_hash FROM seats WHERE role = ?",
                    role,
                )
                .toArray()[0],
        );
    }

    private roleForTokenHash(tokenHash: string): PlayerRole | undefined {
        const row = this.ctx.storage.sql
            .exec<SeatRow>(
                "SELECT role, token_hash FROM seats WHERE token_hash = ?",
                tokenHash,
            )
            .toArray()[0];
        return row?.role;
    }

    private async requireRole(playerToken: string): Promise<PlayerRole> {
        const role = this.roleForTokenHash(await hashToken(playerToken));
        if (!role) throw new Error("プレイヤートークンが無効です。");
        return role;
    }

    private consumeSocketTicket(ticket: string): PlayerRole | undefined {
        const row = this.ctx.storage.sql
            .exec<TicketRow>(
                "SELECT role, expires_at FROM socket_tickets WHERE ticket = ?",
                ticket,
            )
            .toArray()[0];
        this.ctx.storage.sql.exec(
            "DELETE FROM socket_tickets WHERE ticket = ?",
            ticket,
        );
        if (!row || row.expires_at <= Date.now() || !isPlayerRole(row.role))
            return undefined;
        return row.role;
    }

    private async scheduleExpiry(state: GameState): Promise<void> {
        const expiryAt = Date.now() + this.expiryTtl(state);
        const disconnectAt = this.nextDisconnectDeadline();
        await this.ctx.storage.setAlarm(
            disconnectAt ? Math.min(expiryAt, disconnectAt) : expiryAt,
        );
    }

    private expiryTtl(state: GameState): number {
        if (state.phase === "ended") return ENDED_ROOM_TTL_MS;
        return this.openSeats() === 1
            ? ACTIVE_ROOM_TTL_MS
            : WAITING_ROOM_TTL_MS;
    }

    private hasConnectedSockets(): boolean {
        return this.ctx
            .getWebSockets()
            .some((socket) => socket.readyState === WebSocket.OPEN);
    }

    private matchId(): string | undefined {
        const name = this.ctx.id.name;
        return name?.startsWith("match:")
            ? name.slice("match:".length)
            : undefined;
    }

    private openRole(): PlayerRole | undefined {
        if (!this.hasSeat("dark")) return "dark";
        if (!this.hasSeat("government")) return "government";
        return undefined;
    }

    private openSeats(): number {
        return (
            Number(!this.hasSeat("dark")) + Number(!this.hasSeat("government"))
        );
    }

    private clearDisconnectDeadline(role: PlayerRole): void {
        this.ctx.storage.sql.exec(
            "DELETE FROM seat_disconnects WHERE role = ?",
            role,
        );
    }

    private markDisconnected(webSocket: WebSocket): void {
        const attachment =
            webSocket.deserializeAttachment() as SocketAttachment | null;
        if (!attachment || !isPlayerRole(attachment.role)) return;
        if (!this.hasSeat(attachment.role)) return;
        if (this.hasConnectedSocketForRole(attachment.role)) return;
        this.ctx.storage.sql.exec(
            "INSERT INTO seat_disconnects (role, expires_at) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET expires_at = excluded.expires_at",
            attachment.role,
            Date.now() + RECONNECT_GRACE_MS,
        );
    }

    private nextDisconnectDeadline(): number | undefined {
        const row = this.ctx.storage.sql
            .exec<DisconnectRow>(
                "SELECT role, expires_at FROM seat_disconnects ORDER BY expires_at ASC LIMIT 1",
            )
            .toArray()[0];
        return row?.expires_at;
    }

    private hasConnectedSocketForRole(role: PlayerRole): boolean {
        return this.ctx.getWebSockets().some((socket) => {
            if (socket.readyState !== WebSocket.OPEN) return false;
            const attachment =
                socket.deserializeAttachment() as SocketAttachment | null;
            return attachment?.role === role;
        });
    }

    private closeSocketsForRole(role: PlayerRole): void {
        for (const socket of this.ctx.getWebSockets()) {
            const attachment =
                socket.deserializeAttachment() as SocketAttachment | null;
            if (attachment?.role === role) socket.close(1000, "Left match");
        }
    }

    private removeSeat(role: PlayerRole): GameState {
        this.ctx.storage.sql.exec("DELETE FROM seats WHERE role = ?", role);
        this.ctx.storage.sql.exec(
            "DELETE FROM socket_tickets WHERE role = ?",
            role,
        );
        this.clearDisconnectDeadline(role);
        return this.requireState();
    }

    private async releaseExpiredSeats(state: GameState): Promise<GameState> {
        const now = Date.now();
        const expired = this.ctx.storage.sql
            .exec<DisconnectRow>(
                "SELECT role, expires_at FROM seat_disconnects WHERE expires_at <= ?",
                now,
            )
            .toArray();
        if (expired.length === 0) return state;

        for (const { role } of expired) {
            if (!this.hasConnectedSocketForRole(role)) this.removeSeat(role);
            else this.clearDisconnectDeadline(role);
        }
        return this.applyVacancies(state);
    }

    private async applyVacancies(state: GameState): Promise<GameState> {
        const nextState =
            this.openSeats() === 2
                ? this.writeState(createInitialGameState())
                : state;
        await this.syncDirectory(nextState);
        await this.scheduleExpiry(nextState);
        return nextState;
    }

    private async syncDirectory(state: GameState): Promise<void> {
        const matchId = this.matchId();
        if (!matchId) return;
        const vacancies = this.openSeats();
        const status: MatchDirectoryStatus =
            state.phase === "ended"
                ? "ended"
                : vacancies > 0
                  ? "waiting"
                  : "active";
        await this.env.MATCH_DIRECTORY.prepare(
            "UPDATE match_directory SET status = ?, vacancies = ?, updated_at = ? WHERE match_id = ?",
        )
            .bind(status, vacancies, Date.now(), matchId)
            .run();
    }

    private toGameAction(role: PlayerRole, action: ClientAction): GameAction {
        if (action.type === "pass") return { type: "pass", faction: role };
        if (action.type === "charge")
            return {
                type: "charge",
                faction: role,
                instanceId: action.instanceId,
            };
        return {
            type: "play",
            faction: role,
            instanceId: action.instanceId,
            lane: action.lane,
        };
    }

    private snapshot(state: GameState, role: PlayerRole): MatchSnapshot {
        return {
            role,
            view: toMatchView(state, role, this.hasSeat(opponentOf(role))),
        };
    }

    private sendState(
        socket: WebSocket,
        state: GameState,
        role: PlayerRole,
    ): void {
        socket.send(
            JSON.stringify({
                type: "state",
                view: this.snapshot(state, role).view,
            }),
        );
    }

    private broadcast(state: GameState): void {
        for (const socket of this.ctx.getWebSockets()) {
            if (socket.readyState !== WebSocket.OPEN) continue;
            const attachment =
                socket.deserializeAttachment() as SocketAttachment | null;
            if (attachment && isPlayerRole(attachment.role))
                this.sendState(socket, state, attachment.role);
        }
    }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

const developmentOrigins = new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
    "https://frontend.tomop0513-maey.workers.dev",
]);

app.use(
    "/api/*",
    cors({
        origin: (origin, c) =>
            origin === c.env.FRONTEND_ORIGIN || developmentOrigins.has(origin)
                ? origin
                : undefined,
        allowHeaders: ["Content-Type", "X-Player-Token"],
    }),
);

app.post("/api/matches", async (c) => {
    try {
        const matchId = crypto.randomUUID();
        const playerToken = crypto.randomUUID();
        const snapshot = await c.env.GAME_MATCH.getByName(
            `match:${matchId}`,
        ).create(playerToken);
        await setDirectoryStatus(c.env, matchId, "waiting", 1, true);
        return c.json({ matchId, playerToken, ...snapshot }, 201);
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.post("/api/matches/:matchId/join", async (c) => {
    try {
        const playerToken = crypto.randomUUID();
        const snapshot = await matchStub(c).join(playerToken);
        return c.json({ playerToken, ...snapshot });
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.get("/api/matches/open", async (c) => {
    try {
        const { results } = await c.env.MATCH_DIRECTORY.prepare(
            "SELECT match_id, created_at, vacancies FROM match_directory WHERE status = ? ORDER BY created_at DESC LIMIT 12",
        )
            .bind("waiting")
            .all<DirectoryRow>();
        return c.json({
            rooms: results.map((room) => ({
                matchId: room.match_id,
                createdAt: room.created_at,
                vacancies: room.vacancies,
            })),
        });
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.get("/api/matches/:matchId", async (c) => {
    try {
        const playerToken = requirePlayerToken(c.req.header("X-Player-Token"));
        return c.json(await matchStub(c).getState(playerToken));
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.post("/api/matches/:matchId/actions", async (c) => {
    try {
        const playerToken = requirePlayerToken(c.req.header("X-Player-Token"));
        const action = parseClientAction(await c.req.json<unknown>());
        if (!action) return c.json({ error: "アクションが不正です。" }, 400);
        const snapshot = await matchStub(c).act(playerToken, action);
        return c.json(snapshot);
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.post("/api/matches/:matchId/socket-ticket", async (c) => {
    try {
        const playerToken = requirePlayerToken(c.req.header("X-Player-Token"));
        return c.json(await matchStub(c).issueSocketTicket(playerToken));
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.post("/api/matches/:matchId/leave", async (c) => {
    try {
        const playerToken = requirePlayerToken(c.req.header("X-Player-Token"));
        await matchStub(c).leave(playerToken);
        return c.body(null, 204);
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.get("/api/matches/:matchId/socket", async (c) => {
    const ticket = c.req.query("ticket");
    if (!ticket) return c.text("Missing socket ticket", 401);
    const url = new URL(c.req.url);
    url.pathname = "/socket";
    url.search = new URLSearchParams({ ticket }).toString();
    return matchStub(c).fetch(new Request(url, c.req.raw));
});

app.get("/", (c) => c.json({ service: "disaster-game-api", status: "ok" }));

const matchStub = (c: {
    env: CloudflareBindings;
    req: { param(name: "matchId"): string };
}) => c.env.GAME_MATCH.getByName(`match:${c.req.param("matchId")}`);

const setDirectoryStatus = async (
    env: CloudflareBindings,
    matchId: string,
    status: MatchDirectoryStatus,
    vacancies: number,
    create = false,
): Promise<void> => {
    const now = Date.now();
    if (create) {
        await env.MATCH_DIRECTORY.prepare(
            "INSERT INTO match_directory (match_id, status, vacancies, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
            .bind(matchId, status, vacancies, now, now)
            .run();
        return;
    }
    await env.MATCH_DIRECTORY.prepare(
        "UPDATE match_directory SET status = ?, vacancies = ?, updated_at = ? WHERE match_id = ?",
    )
        .bind(status, vacancies, now, matchId)
        .run();
};

const parseClientAction = (value: unknown): ClientAction | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const action = value as { type?: unknown; instanceId?: unknown; lane?: unknown };
    if (action.type === "pass") return { type: "pass" };
    if (action.type === "charge" && typeof action.instanceId === "string") {
        return { type: "charge", instanceId: action.instanceId };
    }
    if (action.type === "play" && typeof action.instanceId === "string") {
        if (action.lane !== undefined && !isLane(action.lane)) return undefined;
        const lane =
            action.lane === "earthquake" ||
            action.lane === "flood" ||
            action.lane === "information"
                ? action.lane
                : undefined;
        return { type: "play", instanceId: action.instanceId, lane };
    }
    return undefined;
};

const requirePlayerToken = (playerToken: string | undefined): string => {
    if (!playerToken) throw new Error("X-Player-Token が必要です。");
    return playerToken;
};

const opponentOf = (role: PlayerRole): PlayerRole =>
    role === "dark" ? "government" : "dark";
const isPlayerRole = (value: unknown): value is PlayerRole =>
    value === "dark" || value === "government";
const isLane = (value: unknown): value is Lane =>
    value === "earthquake" || value === "flood" || value === "information";

const hashToken = async (token: string): Promise<string> => {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
};

const errorResponse = (
    c: {
        json: (
            data: { error: string },
            status: 400 | 401 | 409 | 500,
        ) => Response;
    },
    error: unknown,
) => {
    const message =
        error instanceof Error
            ? error.message
            : "予期しないエラーが発生しました。";
    const status: 400 | 401 | 409 | 500 =
        message.includes("トークン") || message.includes("必要")
            ? 401
            : message.includes("満員")
              ? 409
              : 400;
    console.error(
        JSON.stringify({
            level: "error",
            message,
            timestamp: new Date().toISOString(),
        }),
    );
    return c.json({ error: message }, status);
};

export default app;
