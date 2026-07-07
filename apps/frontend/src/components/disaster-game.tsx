"use client";

import {
  ArrowClockwise,
  Bank,
  BookOpenText,
  Broadcast,
  CloudRain,
  FirstAidKit,
  FlagBanner,
  HandPalm,
  Lightning,
  Radio,
  ShieldCheck,
  Siren,
  Target,
  WarningCircle,
  Waves,
  X,
  type Icon,
} from "@phosphor-icons/react";
import {
  LANES,
  factionLabel,
  laneLabel,
  phaseLabel,
  type CardInstance,
  type Faction,
  type Lane,
  type MatchView,
  type PlayerView,
  type PublicCard,
  type PublicFieldCard,
} from "@disaster-game/game-core";
import { useCallback, useEffect, useState } from "react";
import {
  connectMatchWebSocket,
  createMatch,
  getMatchState,
  joinMatch,
  leaveMatch as leaveMatchRequest,
  listOpenMatches,
  sendMatchAction,
  type ConnectionStatus,
  type OpenMatch,
} from "@/lib/match-client";
import {
  clearMatchSession,
  readLatestMatchSession,
  saveMatchSession,
  type MatchSession,
} from "@/lib/match-session";

const phaseStep = ["回復", "闇の組織", "政府対応", "判定"] as const;

const cardIcons: Record<string, Icon> = {
  earthquake: Lightning,
  misinformation: Broadcast,
  downpour: CloudRain,
  aftershock: Lightning,
  riverSwelling: CloudRain,
  rumorBots: Broadcast,
  seawall: Waves,
  evacuation: Siren,
  stockpile: FirstAidKit,
  furnitureAnchor: ShieldCheck,
  rainwaterPumps: Waves,
  seismicRetrofit: ShieldCheck,
  officialAlert: Radio,
  disasterInfoAlert: Radio,
};

const playTypeLabel = (card: PublicCard | CardInstance): string =>
  card.playType === "ongoingThreat"
    ? "継続脅威"
    : card.playType === "defenseUnit"
      ? "防災ユニット"
      : "単発";

const cardLaneLabel = (card: PublicCard | CardInstance): string =>
  card.lane && card.lane !== "general" ? laneLabel(card.lane) : "共通";

const isPublicCard = (value: unknown): value is PublicCard => {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<PublicCard>;
  return typeof card.name === "string" && typeof card.effect === "object";
};

const playedCard = (value: unknown): PublicCard | undefined => {
  if (isPublicCard(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const played = value as { card?: unknown };
  return isPublicCard(played.card) ? played.card : undefined;
};

const playedLane = (value: unknown): Lane | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const lane = (value as { lane?: unknown }).lane;
  return lane === "earthquake" || lane === "flood" || lane === "information"
    ? lane
    : undefined;
};

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

type PlayerAction =
  | { type: "charge"; instanceId: string }
  | { type: "play"; instanceId: string }
  | { type: "pass" };

type GameCardProps = {
  card: CardInstance;
  faction: Faction;
  playDisabled: boolean;
  chargeDisabled: boolean;
  onPlay: (card: CardInstance) => void;
  onCharge: (card: CardInstance) => void;
};

function GameCard({
  card,
  faction,
  playDisabled,
  chargeDisabled,
  onPlay,
  onCharge,
}: GameCardProps) {
  const CardIcon = cardIcons[card.id] ?? Target;
  const isFullyDisabled = playDisabled && chargeDisabled;
  return (
    <article
      className={`game-card ${isFullyDisabled ? "is-disabled" : ""} ${faction === "dark" ? "threat-card" : "response-card"}`}
      aria-label={card.name}
    >
      <span className="card-cost">
        {card.cost}
        <small>{faction === "dark" ? "CP" : "予算"}</small>
      </span>
      <span className="card-category">
        {card.category === "disaster"
          ? "災害"
          : card.category === "scheme"
            ? "工作"
            : card.category === "countermeasure"
              ? "対策"
              : "啓発"}
      </span>
      <span className="card-meta">
        {cardLaneLabel(card)} / {playTypeLabel(card)}
      </span>
      <CardIcon className="card-icon" weight="duotone" aria-hidden="true" />
      <strong>{card.name}</strong>
      <span className="card-summary">{card.summary}</span>
      <span className="card-tip-label">防災Tipsあり</span>
      <div className="card-actions">
        <button
          type="button"
          disabled={playDisabled}
          onClick={() => onPlay(card)}
          aria-label={`${card.name}をプレイ`}
        >
          プレイ
        </button>
        <button
          type="button"
          disabled={chargeDisabled}
          onClick={() => onCharge(card)}
          aria-label={`${card.name}を基盤化`}
          title="手札1枚を基盤に送り、次ターン以降のリソース回復を+1します。各ターン1回まで。"
        >
          基盤化 +1
        </button>
      </div>
    </article>
  );
}

function PlayerArea({
  view,
  faction,
  submitting,
  onAction,
}: {
  view: MatchView;
  faction: Faction;
  submitting: boolean;
  onAction: (action: PlayerAction) => void;
}) {
  const player: PlayerView = faction === "dark" ? view.dark : view.government;
  const isOwner = view.role === faction;
  const isActive = isOwner && view.canAct;
  const canCharge = isOwner && (view.canCharge ?? view.canAct);
  const title = faction === "dark" ? "闇の組織" : "日本政府";
  const resourceName = faction === "dark" ? "CP" : "予算";
  const PlayerIcon = faction === "dark" ? WarningCircle : Bank;
  const hand = player.hand ?? [];

  return (
    <section
      className={`player-area ${faction === "dark" ? "dark-area" : "government-area"} ${isActive ? "is-active" : ""}`}
      aria-label={title}
    >
      <div className="player-heading">
        <div className="player-title">
          <PlayerIcon size={23} weight="fill" /> <span>{title}</span>
        </div>
        <div className="resource-pill">
          <span>{resourceName}</span>
          <strong>{player.resource}</strong>
          <small>/ 10</small>
        </div>
      </div>
      <p className="player-objective">
        {faction === "dark"
          ? "被害ゲージを100に到達させる"
          : "対策ゲージを100に到達させる"}
      </p>
      <div className="hand-heading">
        <span>
          {isOwner
            ? `手札 ${player.handCount}枚`
            : `相手の手札 ${player.handCount}枚`}
        </span>
        <span>
          山札 {player.deckCount} / 基盤 {player.foundationCount} / 次回回復 +{player.nextRecovery}
        </span>
      </div>
      {isOwner && (
        <p className="foundation-hint">
          {canCharge
            ? "基盤化: 自分のフェイズ中に1枚まで。次ターン以降の回復+1。"
            : isActive
              ? "このターンは基盤化済みです。"
              : "基盤化は自分のフェイズ中に使えます。"}
        </p>
      )}
      {isOwner ? (
        <div className="card-hand">
          {hand.map((card) => (
            <GameCard
              key={card.instanceId}
              card={card}
              faction={faction}
              playDisabled={!isActive || submitting || player.resource < card.cost}
              chargeDisabled={!canCharge || submitting}
              onPlay={(nextCard) =>
                onAction({ type: "play", instanceId: nextCard.instanceId })
              }
              onCharge={(nextCard) =>
                onAction({ type: "charge", instanceId: nextCard.instanceId })
              }
            />
          ))}
        </div>
      ) : (
        <div className="private-hand">
          <ShieldCheck size={34} weight="duotone" />
          <strong>相手の手札は非公開です</strong>
          <span>
            残り {player.handCount} 枚 / 捨札 {player.discardCount} 枚 / 基盤 {player.foundationCount} 枚 / 次回回復 +{player.nextRecovery}
          </span>
        </div>
      )}
      <button
        type="button"
        className="pass-button"
        disabled={!isActive || submitting}
        onClick={() => onAction({ type: "pass" })}
      >
        <HandPalm size={18} weight="bold" />{" "}
        {isActive
          ? "パスする"
          : isOwner
            ? "相手の操作を待っています"
            : "相手のエリア"}
      </button>
    </section>
  );
}

function LaneCardList({
  cards,
  emptyLabel,
}: {
  cards: PublicFieldCard[];
  emptyLabel: string;
}) {
  if (cards.length === 0) {
    return <span className="lane-empty">{emptyLabel}</span>;
  }

  return (
    <div className="lane-card-stack">
      {cards.map((card, index) => (
        <span
          key={`${card.owner}-${card.id}-${index}`}
          className={card.ready ? "lane-card-ready" : "lane-card-waiting"}
        >
          {card.name}
          <small>{card.ready ? "ready" : "準備中"}</small>
        </span>
      ))}
    </div>
  );
}

function LaneBoard({ view }: { view: MatchView }) {
  const pendingResponseCard = playedCard(view.pendingResponse);
  const pendingResponseLane = playedLane(view.pendingResponse);
  const commonResponse =
    pendingResponseCard && !pendingResponseLane
      ? pendingResponseCard
      : undefined;

  return (
    <section className="lane-board" aria-label="現場レーン">
      <div className="lane-board-heading">
        <span>現場レーン</span>
        <small>継続カードは次ターンから有効</small>
      </div>
      {LANES.map((lane: Lane) => {
        const laneState = view.field?.lanes?.[lane] ?? {
          threats: [],
          defenses: [],
        };
        const pendingThreatCard = playedCard(view.pendingThreat);
        const pendingThreatLane = playedLane(view.pendingThreat);
        const pendingThreat =
          pendingThreatLane === lane ? pendingThreatCard : undefined;
        const pendingResponse =
          pendingResponseLane === lane ? pendingResponseCard : undefined;

        return (
          <div className="lane-row" key={lane}>
            <strong>{laneLabel(lane)}</strong>
            <div>
              <span className="lane-side-title">脅威</span>
              {pendingThreat ? (
                <b className="lane-pending danger-text">{pendingThreat.name}</b>
              ) : (
                <LaneCardList
                  cards={laneState.threats}
                  emptyLabel="継続脅威なし"
                />
              )}
            </div>
            <div>
              <span className="lane-side-title">対応</span>
              {pendingResponse ? (
                <b className="lane-pending safety-text">
                  {pendingResponse.name}
                </b>
              ) : (
                <LaneCardList
                  cards={laneState.defenses}
                  emptyLabel="防災ユニットなし"
                />
              )}
            </div>
          </div>
        );
      })}
      {commonResponse && (
        <p className="common-response">
          共通対応: <strong>{commonResponse.name}</strong>
        </p>
      )}
    </section>
  );
}

function PlayedSummaryPanel({
  title,
  tone,
  card,
  fallback,
  icon: FallbackIcon,
}: {
  title: string;
  tone: "dark" | "government";
  card?: PublicCard;
  fallback: string;
  icon: Icon;
}) {
  const CardIcon = card ? (cardIcons[card.id] ?? Target) : FallbackIcon;

  return (
    <div className={tone === "dark" ? "played-card-panel" : "response-card-panel"}>
      <span className={tone === "dark" ? "eyebrow" : "eyebrow safety-eyebrow"}>
        {title}
      </span>
      <CardIcon size={48} weight="duotone" aria-hidden="true" />
      <strong>{card?.name ?? "未選択"}</strong>
      <p>{card?.summary ?? fallback}</p>
      {card && (
        <span className="played-card-meta">
          {cardLaneLabel(card)} / {playTypeLabel(card)}
        </span>
      )}
    </div>
  );
}

function Lobby({
  busy,
  rooms,
  roomsLoading,
  onCreate,
  onJoin,
  onRefresh,
  notice,
}: {
  busy: boolean;
  rooms: OpenMatch[];
  roomsLoading: boolean;
  onCreate: () => void;
  onJoin: (matchId: string) => void;
  onRefresh: () => void;
  notice: string | null;
}) {
  return (
    <main className="game-page">
      <div className="mobile-notice">
        <WarningCircle size={32} weight="duotone" />
        <strong>このプロトタイプはPC画面向けです。</strong>
        <span>横幅1000px以上の端末でプレイしてください。</span>
      </div>
      <section className="lobby-shell" aria-label="オンライン対戦ルーム">
        <div className="lobby-mark">
          <Radio size={34} weight="fill" />
        </div>
        <p className="lobby-eyebrow">DISASTER COMMAND ONLINE</p>
        <h1>対戦ルームに接続</h1>
        <p>空いている陣営として参加します。両者が離れるとルームは再募集されます。</p>
        <button
          type="button"
          className="lobby-primary"
          disabled={busy}
          onClick={onCreate}
        >
          <Lightning size={20} weight="fill" /> 新しいルームを作成
        </button>
        <div className="lobby-divider">
          <span>空きルーム</span>
        </div>
        <div className="lobby-room-heading">
          <span>参加待ちの対戦</span>
          <button
            type="button"
            className="lobby-refresh"
            disabled={busy || roomsLoading}
            onClick={onRefresh}
          >
            <ArrowClockwise size={15} weight="bold" /> 更新
          </button>
        </div>
        <div className="lobby-room-list" aria-live="polite">
          {rooms.length > 0 ? (
            rooms.map((room, index) => (
              <div className="lobby-room" key={room.matchId}>
                <div>
                  <strong>対戦ルーム {index + 1}</strong>
                  <span>
                    作成 {new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(room.createdAt))} ・ あと{room.vacancies}人
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onJoin(room.matchId)}
                >
                  参加
                </button>
              </div>
            ))
          ) : (
            <p className="lobby-empty">
              {roomsLoading ? "空きルームを確認中です。" : "参加待ちのルームはありません。"}
            </p>
          )}
        </div>
        {notice && <p className="lobby-error" role="status">{notice}</p>}
        <p className="lobby-note">
          <ShieldCheck size={16} weight="fill" />{" "}
          相手の手札はサーバーから送信されません。
        </p>
      </section>
    </main>
  );
}

export function DisasterGame() {
  const [session, setSession] = useState<MatchSession | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [rooms, setRooms] = useState<OpenMatch[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");

  const activateSession = useCallback(async (nextSession: MatchSession) => {
    setBusy(true);
    try {
      const snapshot = await getMatchState(nextSession);
      saveMatchSession({ ...nextSession, role: snapshot.role });
      setSession({ ...nextSession, role: snapshot.role });
      setView(snapshot.view);
      setNotice(null);
    } catch (error) {
      clearMatchSession(nextSession.matchId);
      setNotice(
        error instanceof Error
          ? error.message
          : "ルームへ接続できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const response = await listOpenMatches();
      setRooms(response.rooms);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "空きルームを取得できませんでした。",
      );
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = readLatestMatchSession();
    if (stored) void activateSession(stored);
    void refreshRooms();
    setReady(true);
  }, [activateSession, refreshRooms]);

  useEffect(() => {
    if (!session) return;
    return connectMatchWebSocket(session, setView, setConnectionStatus);
  }, [session]);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const created = await createMatch();
      const nextSession: MatchSession = {
        matchId: created.matchId,
        playerToken: created.playerToken,
        role: created.role,
      };
      saveMatchSession(nextSession);
      setSession(nextSession);
      setView(created.view);
      setNotice("参加待ちのルームを作成しました。相手は空きルーム一覧から参加できます。");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "ルームを作成できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (matchId: string) => {
    setBusy(true);
    try {
      const joined = await joinMatch(matchId);
      const nextSession: MatchSession = {
        matchId,
        playerToken: joined.playerToken,
        role: joined.role,
      };
      saveMatchSession(nextSession);
      setSession(nextSession);
      setView(joined.view);
      void refreshRooms();
      setNotice(`${factionLabel(joined.role)}としてルームへ参加しました。`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "ルームへ参加できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAction = async (action: PlayerAction) => {
    if (!session) return;
    setBusy(true);
    try {
      const snapshot = await sendMatchAction(session, action);
      setView(snapshot.view);
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "操作を送信できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  };

  const leaveMatch = async () => {
    if (session) {
      try {
        await leaveMatchRequest(session);
      } catch {
        // タブ終了時など既に切断済みでも、ローカル状態は必ず破棄する。
      }
      clearMatchSession(session.matchId);
    }
    setSession(null);
    setView(null);
    setTipsOpen(false);
    setNotice(null);
    void refreshRooms();
  };

  if (!ready || (!session && !view)) {
    return (
      <Lobby
        busy={busy}
        rooms={rooms}
        roomsLoading={roomsLoading}
        onCreate={handleCreate}
        onJoin={handleJoin}
        onRefresh={() => void refreshRooms()}
        notice={notice}
      />
    );
  }

  if (!view || !session) return null;

  const threatCard = playedCard(view.pendingThreat);
  const responseCard = playedCard(view.pendingResponse);
  const revealedShields = view.revealedShields ?? [];
  const shieldCount = view.shieldCount ?? 0;
  const activityLog = view.log ?? [];
  const currentTips = view.activeTips ?? [];
  const lastResolution = view.lastResolution as
    | (NonNullable<MatchView["lastResolution"]> & Record<string, unknown>)
    | undefined;
  const lastResolutionNumber = (key: string, fallback = 0): number =>
    lastResolution ? finiteNumber(lastResolution[key], fallback) : fallback;
  const rawDamage = lastResolution
    ? lastResolutionNumber("rawDamage", threatCard?.effect?.damage ?? 0)
    : (threatCard?.effect?.damage ?? 0);
  const remainingDamageBeforeShield = lastResolution
    ? lastResolutionNumber(
        "remainingDamageBeforeShield",
        lastResolutionNumber("remainingDamage", rawDamage),
      )
    : undefined;
  const shieldAbsorbed = lastResolutionNumber("shieldAbsorbed");
  const activeTips =
    currentTips.length > 0
      ? currentTips
      : [
          {
            cardName: "防災の基本",
            text: "避難経路と連絡方法を、日頃から家族や身近な人と確認しましょう。",
          },
        ];
  const primaryTip = activeTips[0];
  const phaseIndex =
    view.phase === "dark" ? 1 : view.phase === "government" ? 2 : 3;
  const connectionLabel =
    connectionStatus === "connected"
      ? "同期中"
      : connectionStatus === "reconnecting"
        ? "再接続中"
        : "接続中";

  return (
    <main className="game-page">
      <div className="mobile-notice">
        <WarningCircle size={32} weight="duotone" />
        <strong>このプロトタイプはPC画面向けです。</strong>
        <span>横幅1000px以上の端末でプレイしてください。</span>
      </div>
      <div className="game-shell">
        <header className="command-header">
          <div className="header-team header-dark">
            <WarningCircle size={38} weight="fill" />
            <div>
              <strong>THREAT CONTROL</strong>
              <span>PLAYER 1 / 闇の組織</span>
            </div>
          </div>
          <div className="status-command">
            <div className="gauge-row">
              <span>被害ゲージ</span>
              <div className="gauge-track danger">
                <i style={{ width: `${view.damage}%` }} />
              </div>
              <strong>
                {view.damage} <small>/ 100</small>
              </strong>
            </div>
            <div className="turn-phase">
              <span>TURN {view.turn}</span>
              <b>{phaseLabel(view.phase)}</b>
            </div>
            <div className="gauge-row">
              <span>対策ゲージ</span>
              <div className="gauge-track safety">
                <i style={{ width: `${view.countermeasures}%` }} />
              </div>
              <strong>
                {view.countermeasures} <small>/ 100</small>
              </strong>
            </div>
          </div>
          <div className="header-team header-government">
            <div>
              <strong>GOVERNMENT RESPONSE</strong>
              <span>PLAYER 2 / 日本政府</span>
            </div>
            <ShieldCheck size={42} weight="fill" />
          </div>
        </header>

        <section className="phase-strip" aria-label="ターン進行">
          {phaseStep.map((step, index) => (
            <span
              key={step}
              className={`phase-step ${index <= phaseIndex ? "phase-done" : ""}`}
            >
              <i>{index + 1}</i>
              {step}
            </span>
          ))}
          <span className={`connection-badge ${connectionStatus}`}>
            {connectionLabel}
          </span>
          <button
            type="button"
            className="leave-room-button"
            disabled={busy}
            onClick={() => void leaveMatch()}
          >
            ルームを退出
          </button>
        </section>

        <section className="resolution-zone">
          <div className="played-card-stack">
            <PlayedSummaryPanel
              title="現在の脅威"
              tone="dark"
              card={threatCard}
              fallback="闇の組織がカードをプレイすると、政府が対応を選択できます。"
              icon={FlagBanner}
            />
            <PlayedSummaryPanel
              title="政府の対応"
              tone="government"
              card={responseCard}
              fallback="政府フェイズで対応カード、啓発カード、防災ユニットを選択します。"
              icon={ShieldCheck}
            />
          </div>
          <div className="resolution-main">
            <div className="resolution-title">
              <Target size={20} weight="fill" /> 共通状況
            </div>
            <div className="resolution-values">
              <div>
                <span>基礎威力</span>
                <strong>{rawDamage}</strong>
              </div>
              <div>
                <span>シールド前</span>
                <strong className="danger-text">
                  {remainingDamageBeforeShield ?? "-"}
                </strong>
              </div>
              <div>
                <span>ゲージ被害</span>
                <strong className="danger-text">
                  {lastResolution
                    ? `+${lastResolutionNumber("damageToGauge", lastResolutionNumber("remainingDamage"))}`
                    : "-"}
                </strong>
              </div>
              <div>
                <span>対策獲得</span>
                <strong className="safety-text">
                  {lastResolution
                    ? `+${lastResolutionNumber("countermeasureGain")}`
                    : "-"}
                </strong>
              </div>
            </div>
            {lastResolution && (
              <div className="resolution-breakdown" aria-label="判定内訳">
                <div>
                  <span>継続威力</span>
                  <strong className="danger-text">
                    +{lastResolutionNumber("persistentDamage")}
                  </strong>
                </div>
                <div>
                  <span>通常軽減</span>
                  <strong className="safety-text">
                    -{lastResolutionNumber("mitigation")}
                  </strong>
                </div>
                <div>
                  <span>緊急軽減</span>
                  <strong className="safety-text">
                    -{lastResolutionNumber("triggerMitigation")}
                  </strong>
                </div>
                <div>
                  <span>シールド吸収</span>
                  <strong className="safety-text">
                    -{shieldAbsorbed}
                  </strong>
                </div>
                <p
                  className={
                    lastResolution.responseLane &&
                    !lastResolution.responseMatched
                      ? "resolution-note is-mismatch"
                      : "resolution-note"
                  }
                >
                  {lastResolution.responseLane &&
                  lastResolution.threatLane
                    ? lastResolution.responseMatched
                      ? `${laneLabel(lastResolution.responseLane)}で対応が一致しました。`
                      : `${laneLabel(lastResolution.responseLane)}の対応は、${laneLabel(lastResolution.threatLane)}の脅威には通常軽減として入りません。`
                    : "共通対応またはレーン外効果として処理されました。"}
                </p>
              </div>
            )}
            <div className="shield-status" aria-label="防災シールド">
              <div>
                <span>防災シールド</span>
                <strong>{shieldCount}枚</strong>
              </div>
              <div className="shield-dots" aria-hidden="true">
                {Array.from({ length: Math.max(shieldCount, 0) }).map(
                  (_, index) => (
                    <i key={index} />
                  ),
                )}
              </div>
              <p>
                {lastResolution?.revealedShield
                  ? `公開: ${lastResolution.revealedShield.name} / 吸収 ${shieldAbsorbed}`
                  : revealedShields.length > 0
                    ? `直近公開: ${revealedShields[0].name}`
                    : "被害が通ると1枚公開され、被害を半減します。"}
              </p>
            </div>
            <LaneBoard view={view} />
            <p className="phase-prompt">
              {view.phase === "ended"
                ? "ゲームは終了しました。"
                : view.canAct
                  ? "あなたが操作中です。"
                  : view.phase === "resolution"
                    ? "判定処理中です。"
                    : `${factionLabel(view.phase === "government" ? "government" : "dark")}が操作中です。`}
            </p>
          </div>
          <aside className="tips-panel">
            <div className="tip-title">
              <BookOpenText size={22} weight="fill" /> 防災Tips
            </div>
            <p className="tip-preview">
              <strong>{primaryTip.cardName}</strong>
              {primaryTip.text}
            </p>
            <button
              type="button"
              className="tips-more"
              onClick={() => setTipsOpen(true)}
            >
              すべてのTipsを見る（{activeTips.length}）
            </button>
          </aside>
        </section>

        <section className="players-grid">
          <PlayerArea
            view={view}
            faction="dark"
            submitting={busy}
            onAction={handleAction}
          />
          <PlayerArea
            view={view}
            faction="government"
            submitting={busy}
            onAction={handleAction}
          />
        </section>

        <section className="activity-log" aria-label="アクティビティログ">
          <div className="log-title">
            <Radio size={18} weight="fill" /> アクティビティログ
          </div>
          <div className="log-items">
            {activityLog.slice(0, 4).map((entry) => (
              <span
                key={`${entry.id}+${entry.tone}`}
                className={`log-${entry.tone}`}
              >
                T{entry.turn} · {entry.message}
              </span>
            ))}
          </div>
        </section>
      </div>

      {notice && (
        <div className="notice" role="status">
          <X size={18} weight="bold" />
          {notice}
        </div>
      )}
      {tipsOpen && (
        <div
          className="tips-overlay"
          role="presentation"
          onMouseDown={() => setTipsOpen(false)}
        >
          <section
            className="tips-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tips-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tips-modal-heading">
              <div>
                <span>DISASTER PREPAREDNESS</span>
                <h2 id="tips-modal-title">防災Tips</h2>
              </div>
              <button
                type="button"
                aria-label="防災Tipsを閉じる"
                onClick={() => setTipsOpen(false)}
              >
                <X size={20} weight="bold" />
              </button>
            </div>
            <div className="tips-modal-list">
              {activeTips.map((tip) => (
                <article key={`${tip.cardName}-${tip.text}`}>
                  <strong>{tip.cardName}</strong>
                  <p>{tip.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {view.winner && (
        <div
          className="end-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="ゲーム終了"
        >
          <div className="end-modal">
            <ShieldCheck size={48} weight="duotone" />
            <span>GAME OVER</span>
            <h1>
              {view.winner === "draw"
                ? "引き分け"
                : `${factionLabel(view.winner)}の勝利`}
            </h1>
            <p>
              被害 {view.damage} / 対策 {view.countermeasures}
            </p>
            <button type="button" onClick={() => void leaveMatch()}>
              <ArrowClockwise size={18} weight="bold" /> ルーム一覧へ戻る
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
