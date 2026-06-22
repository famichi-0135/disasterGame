import type { Faction, MatchView } from "@disaster-game/game-core";
import type { MatchSession } from "./match-session";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

type MatchSnapshot = {
	role: Faction;
	view: MatchView;
};

type CreatedMatch = MatchSnapshot & {
	matchId: string;
	playerToken: string;
};

type JoinedMatch = MatchSnapshot & {
	playerToken: string;
};

type ApiError = { error?: string };

export type OpenMatch = {
	matchId: string;
	createdAt: number;
	vacancies: number;
};

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

const apiUrl = (path: string): string => `${apiBase}${path}`;

const request = async <T>(path: string, init: RequestInit = {}, playerToken?: string): Promise<T> => {
	const headers = new Headers(init.headers);
	if (init.body) headers.set("Content-Type", "application/json");
	if (playerToken) headers.set("X-Player-Token", playerToken);

	const response = await fetch(apiUrl(path), { ...init, headers });
	const payload = await response.json().catch(() => ({})) as T & ApiError;
	if (!response.ok) throw new Error(payload.error ?? "通信に失敗しました。");
	return payload;
};

export const createMatch = (): Promise<CreatedMatch> => request<CreatedMatch>("/api/matches", { method: "POST" });

export const joinMatch = (matchId: string): Promise<JoinedMatch> =>
	request<JoinedMatch>(`/api/matches/${encodeURIComponent(matchId)}/join`, { method: "POST" });

export const leaveMatch = (session: MatchSession): Promise<Record<string, never>> =>
	request<Record<string, never>>(
		`/api/matches/${encodeURIComponent(session.matchId)}/leave`,
		{ method: "POST" },
		session.playerToken,
	);

export const listOpenMatches = (): Promise<{ rooms: OpenMatch[] }> =>
	request<{ rooms: OpenMatch[] }>("/api/matches/open");

export const getMatchState = (session: MatchSession): Promise<MatchSnapshot> =>
	request<MatchSnapshot>(`/api/matches/${encodeURIComponent(session.matchId)}`, {}, session.playerToken);

export const sendMatchAction = (
	session: MatchSession,
	action: { type: "play"; instanceId: string } | { type: "pass" },
): Promise<MatchSnapshot> =>
	request<MatchSnapshot>(
		`/api/matches/${encodeURIComponent(session.matchId)}/actions`,
		{ method: "POST", body: JSON.stringify(action) },
		session.playerToken,
	);

const issueSocketTicket = (session: MatchSession): Promise<{ ticket: string }> =>
	request<{ ticket: string }>(
		`/api/matches/${encodeURIComponent(session.matchId)}/socket-ticket`,
		{ method: "POST" },
		session.playerToken,
	);

const socketUrl = (matchId: string, ticket: string): string => {
	const url = new URL(apiUrl(`/api/matches/${encodeURIComponent(matchId)}/socket`));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("ticket", ticket);
	return url.toString();
};

export const connectMatchWebSocket = (
	session: MatchSession,
	onState: (view: MatchView) => void,
	onStatus: (status: ConnectionStatus) => void,
): (() => void) => {
	let cancelled = false;
	let socket: WebSocket | null = null;
	let retryId: number | undefined;

	const connect = async (): Promise<void> => {
		if (cancelled) return;
		onStatus(socket ? "reconnecting" : "connecting");
		try {
			const { ticket } = await issueSocketTicket(session);
			if (cancelled) return;
			socket = new WebSocket(socketUrl(session.matchId, ticket));
			socket.onopen = () => onStatus("connected");
			socket.onmessage = (event) => {
				try {
					const payload = JSON.parse(String(event.data)) as { type?: unknown; view?: MatchView };
					if (payload.type === "state" && payload.view) onState(payload.view);
				} catch {
					// 不正なリアルタイムメッセージは無視し、次回同期で回復する。
				}
			};
			socket.onclose = () => {
				if (!cancelled) retryId = window.setTimeout(() => void connect(), 1_500);
			};
			socket.onerror = () => socket?.close();
		} catch {
			if (!cancelled) retryId = window.setTimeout(() => void connect(), 1_500);
		}
	};

	void connect();
	return () => {
		cancelled = true;
		if (retryId) window.clearTimeout(retryId);
		socket?.close();
	};
};
