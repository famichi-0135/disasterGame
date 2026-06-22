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
  factionLabel,
  phaseLabel,
  type CardInstance,
  type Faction,
  type MatchView,
  type PlayerView,
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
  seawall: Waves,
  evacuation: Siren,
  stockpile: FirstAidKit,
};

type GameCardProps = {
  card: CardInstance;
  faction: Faction;
  disabled: boolean;
  onPlay: (card: CardInstance) => void;
};

function GameCard({ card, faction, disabled, onPlay }: GameCardProps) {
  const CardIcon = cardIcons[card.id] ?? Target;
  return (
    <button
      type="button"
      className={`game-card ${faction === "dark" ? "threat-card" : "response-card"}`}
      disabled={disabled}
      onClick={() => onPlay(card)}
      aria-label={`${card.name}をプレイ`}
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
      <CardIcon className="card-icon" weight="duotone" aria-hidden="true" />
      <strong>{card.name}</strong>
      <span className="card-summary">{card.summary}</span>
      <span className="card-tip-label">防災Tipsあり</span>
    </button>
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
  onAction: (
    action: { type: "play"; instanceId: string } | { type: "pass" },
  ) => void;
}) {
  const player: PlayerView = faction === "dark" ? view.dark : view.government;
  const isOwner = view.role === faction;
  const isActive = isOwner && view.canAct;
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
        <span>山札 {player.deckCount}</span>
      </div>
      {isOwner ? (
        <div className="card-hand">
          {hand.map((card) => (
            <GameCard
              key={card.instanceId}
              card={card}
              faction={faction}
              disabled={!isActive || submitting || player.resource < card.cost}
              onPlay={(nextCard) =>
                onAction({ type: "play", instanceId: nextCard.instanceId })
              }
            />
          ))}
        </div>
      ) : (
        <div className="private-hand">
          <ShieldCheck size={34} weight="duotone" />
          <strong>相手の手札は非公開です</strong>
          <span>
            残り {player.handCount} 枚 / 捨札 {player.discardCount} 枚
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

  const handleAction = async (
    action: { type: "play"; instanceId: string } | { type: "pass" },
  ) => {
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

  const activeCard = view.pendingResponse ?? view.pendingThreat;
  const ActiveIcon = activeCard
    ? (cardIcons[activeCard.id] ?? Target)
    : FlagBanner;
  const responseCard = view.pendingResponse;
  const ResponseIcon = responseCard
    ? (cardIcons[responseCard.id] ?? ShieldCheck)
    : ShieldCheck;
  const activeTips =
    view.activeTips.length > 0
      ? view.activeTips
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
          <div className="played-card-panel">
            <span className="eyebrow">現在の脅威</span>
            <ActiveIcon size={48} weight="duotone" />
            <strong>{activeCard?.name ?? "カードの選択を待っています"}</strong>
            <p>
              {activeCard?.summary ??
                "闇の組織がカードをプレイすると、政府が対応を選択できます。"}
            </p>
          </div>
          <div className="resolution-main">
            <div className="resolution-title">
              <Target size={20} weight="fill" /> 共通状況
            </div>
            <div className="resolution-values">
              <div>
                <span>基礎威力</span>
                <strong>
                  {view.lastResolution?.rawDamage ??
                    view.pendingThreat?.effect.damage ??
                    0}
                </strong>
              </div>
              <div>
                <span>残余被害</span>
                <strong className="danger-text">
                  {view.lastResolution?.remainingDamage ?? "-"}
                </strong>
              </div>
              <div>
                <span>対策獲得</span>
                <strong className="safety-text">
                  {view.lastResolution
                    ? `+${view.lastResolution.countermeasureGain}`
                    : "-"}
                </strong>
              </div>
            </div>
            <p className="phase-prompt">
              {view.phase === "ended"
                ? "ゲームは終了しました。"
                : view.canAct
                  ? "あなたが操作中です。"
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
            {view.log.slice(0, 4).map((entry) => (
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
