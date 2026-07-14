/**
 * REDACTED client — DOM/CSS only, five states (UI.md). No canvas, no physics.
 * Speaks only the shared/api contracts; imports NO server code (I2 by path).
 */

import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api } from './api';
import * as audio from './audio';
import type { BoardResponse, CaseResponse, VerdictResponse } from '../shared/api';
import type { ShardView } from '../shared/case';

type Tab = 'dossier' | 'board' | 'accuse' | 'verdict';

const Meter = ({ pct, label }: { pct: number; label: string }): React.ReactElement => (
  <>
    <div className="meter">
      <span style={{ width: `${pct}%` }} />
    </div>
    <div className="meter-label">{label}</div>
  </>
);

const Folder = ({ c }: { c: CaseResponse['case'] }): React.ReactElement => (
  <div className="folder">
    <div className="plate">
      CASE #{c.number} · DAY {c.day} · {c.meter.pct}% UNREDACTED
    </div>
    <div className="title">{c.title}</div>
    <div className="tagline">{c.tagline}</div>
    <Meter pct={c.meter.pct} label={`${c.meter.revealed}/${c.meter.total} shards on the board · verdict ${new Date(c.verdictAtUtc).getUTCHours()}:00 UTC`} />
  </div>
);

const ShardBar = ({
  view,
  peeled,
  onPeel,
}: {
  view: ShardView;
  peeled: boolean;
  onPeel: (id: string) => void;
}): React.ReactElement => {
  if (view.visibility === 'censored') {
    return (
      <span className="shard" data-vis="censored">
        <span className="bar" style={{ width: `${view.barWidth}ch` }} />
      </span>
    );
  }
  if (view.visibility === 'mine') {
    return (
      <span className="shard" data-vis="mine" data-peeled={peeled}>
        {peeled ? (
          <span className="reveal">{view.text}</span>
        ) : (
          <span
            className="bar"
            style={{ width: `${view.barWidth}ch` }}
            role="button"
            tabIndex={0}
            onClick={() => onPeel(view.shardId)}
            onKeyDown={(e) => e.key === 'Enter' && onPeel(view.shardId)}
          />
        )}
      </span>
    );
  }
  return (
    <span className="shard" data-vis={view.visibility}>
      <span className="reveal">{view.text}</span>
      <span className="tag">{view.visibility === 'public' ? 'PUBLIC RECORD' : view.filedBy ?? 'FILED'}</span>
    </span>
  );
};

const Dossier = ({
  data,
  peeled,
  onPeel,
}: {
  data: CaseResponse;
  peeled: Set<string>;
  onPeel: (id: string) => void;
}): React.ReactElement => {
  const byId = useMemo(() => new Map(data.shards.map((s) => [s.shardId, s])), [data.shards]);
  return (
    <>
      {data.case.docs.map((doc) => (
        <div className="doc" key={doc.id}>
          <h3>{doc.title}</h3>
          {doc.lines.map((line, i) => (
            <p className="line" key={i}>
              {line.kind === 'text' ? (
                line.text
              ) : (
                <ShardBar view={byId.get(line.shardId)!} peeled={peeled.has(line.shardId)} onPeel={onPeel} />
              )}
            </p>
          ))}
        </div>
      ))}
    </>
  );
};

const Board = ({ data }: { data: BoardResponse }): React.ReactElement => (
  <>
    <div className="folder">
      <div className="plate">EVIDENCE BOARD</div>
      <Meter pct={data.meter.pct} label={`${data.cards.length} cards filed · red string is computed, not moderated`} />
    </div>
    {data.contradictions.map((x) => (
      <div className="contradiction" key={`${x.a}|${x.b}`}>
        <div className="label">⚡ CONTRADICTION</div>
        <div className="note">{x.note}</div>
      </div>
    ))}
    {data.cards.length === 0 && <p className="small center">No cards filed yet. Peel your shard and file the first.</p>}
    {data.cards.map((card) => (
      <div className="card" key={card.shardId} data-public={card.publicRecord}>
        <div className="who">
          <span>{card.author}</span>
          <span>{card.publicRecord ? 'PUBLIC RECORD' : `via ${card.via}`}</span>
        </div>
        <div className="txt">{card.text}</div>
      </div>
    ))}
  </>
);

const Accuse = ({
  data,
  onAccuse,
}: {
  data: CaseResponse;
  onAccuse: (suspectId: string, stake: number) => void;
}): React.ReactElement => {
  const [pick, setPick] = useState<string | null>(null);
  const [stake, setStake] = useState(25);
  const accused = data.you.accused;
  return (
    <>
      <div className="folder">
        <div className="plate">ACCUSE · {data.case.question}</div>
        <div className="meter-label">Stake season points on one name. One accusation per case — locked.</div>
      </div>
      {data.case.suspects.map((s) => (
        <div
          className="suspect"
          key={s.id}
          data-elim={s.eliminated}
          onClick={() => !s.eliminated && !accused && setPick(s.id)}
          style={{ outline: pick === s.id ? '1px solid var(--amber)' : 'none', cursor: s.eliminated ? 'default' : 'pointer' }}
        >
          <div className="row">
            <span className="name">{s.name}</span>
            <span className="small">{Math.round(s.lean * 100)}%</span>
          </div>
          <div className="leanbar">
            <span style={{ width: `${Math.round(s.lean * 100)}%` }} />
          </div>
          <div className="blurb">{s.eliminated ? 'ELIMINATED by the board.' : s.blurb}</div>
        </div>
      ))}
      {accused ? (
        <p className="center" style={{ marginTop: 20 }}>
          <span className="stamp">ACCUSATION SEALED</span>
        </p>
      ) : (
        <div style={{ padding: '12px 16px' }}>
          <div className="small">Stake: {stake} pts (you have {data.you.seasonPoints})</div>
          <input className="range" type="range" min={5} max={100} step={5} value={stake} onChange={(e) => setStake(Number(e.target.value))} />
          <button className="btn solid" disabled={!pick} onClick={() => pick && onAccuse(pick, stake)}>
            {pick ? `SEAL ACCUSATION` : 'PICK A SUSPECT'}
          </button>
        </div>
      )}
    </>
  );
};

const Verdict = ({ v }: { v: VerdictResponse }): React.ReactElement => {
  if (!v.verdict) {
    return (
      <div className="folder">
        <div className="plate">VERDICT PENDING</div>
        <div className="meter-label">The ceremony crowns the earliest correct accusers at the scheduled hour.</div>
      </div>
    );
  }
  return (
    <>
      <div className="folder">
        <div className="plate">VERDICT — {v.verdict.culpritName.toUpperCase()}</div>
        <div className="tagline">{v.verdict.motive}</div>
      </div>
      {v.verdict.reveal.map((beat, i) => (
        <div className="reveal-beat" key={i}>
          {beat}
        </div>
      ))}
      <div className="folder" style={{ borderTop: '1px solid var(--ink-2)' }}>
        <div className="plate">CROWNED</div>
        {v.verdict.winners.length === 0 && <div className="small">No correct accusers this time.</div>}
        {v.verdict.winners.map((w, i) => (
          <div className="small" key={i}>
            {i < 3 ? ['🥇', '🥈', '🥉'][i] : '·'} u/{w.username} +{w.payout}
          </div>
        ))}
      </div>
    </>
  );
};

const FileModal = ({
  shard,
  onClose,
  onFile,
}: {
  shard: ShardView;
  onClose: () => void;
  onFile: (via: 'user' | 'app') => void;
}): React.ReactElement => {
  const [asUser, setAsUser] = useState(true);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>FILE EVIDENCE CARD</h2>
        <div className="card">
          <div className="who">
            <span>your line</span>
            <span>shard {shard.shardId}</span>
          </div>
          <div className="txt">{shard.text}</div>
        </div>
        <label className="consent">
          <input type="checkbox" checked={asUser} onChange={(e) => setAsUser(e.target.checked)} />
          Post this card under my username (else the app posts it)
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button className="btn solid" onClick={() => onFile(asUser ? 'user' : 'app')}>
            FILE MY EVIDENCE
          </button>
          <button className="btn" onClick={onClose}>
            not yet
          </button>
        </div>
      </div>
    </div>
  );
};

const App = (): React.ReactElement => {
  const [tab, setTab] = useState<Tab>('dossier');
  const [data, setData] = useState<CaseResponse | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [verdict, setVerdict] = useState<VerdictResponse | null>(null);
  const [peeled, setPeeled] = useState<Set<string>>(new Set());
  const [fileShardId, setFileShardId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    before: number;
    after: number;
    struck: string[];
    lit?: string;
    duplicate: boolean;
  } | null>(null);

  const loadCase = useCallback(async () => {
    try {
      setData(await api.case());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  useEffect(() => {
    audio.mountMuteButton();
    const unlockOnce = (): void => audio.unlock();
    document.addEventListener('pointerdown', unlockOnce, { once: true });
    document.addEventListener('keydown', unlockOnce, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlockOnce);
      document.removeEventListener('keydown', unlockOnce);
    };
  }, []);

  useEffect(() => {
    if (tab === 'board') api.board().then(setBoard).catch((e) => setErr((e as Error).message));
    if (tab === 'verdict') api.verdict().then(setVerdict).catch((e) => setErr((e as Error).message));
  }, [tab]);

  const onPeel = (id: string): void => {
    audio.peel();
    setPeeled((prev) => new Set(prev).add(id));
  };

  const doFile = async (via: 'user' | 'app'): Promise<void> => {
    if (!fileShardId || !data) return;
    try {
      const before = data.case.meter.pct;
      const res = await api.file({ shardId: fileShardId, via });
      if (res.eliminatedSuspectIds.length > 0) audio.strike();
      else if (res.litContradiction) audio.litString();
      else audio.file();
      const nameOf = new Map(data.case.suspects.map((s) => [s.id, s.name]));
      setReceipt({
        before,
        after: res.meterPct,
        struck: res.eliminatedSuspectIds.map((id) => nameOf.get(id) ?? id),
        lit: res.litContradiction?.note,
        duplicate: res.duplicate,
      });
      setFileShardId(null);
      await loadCase();
      setBoard(await api.board());
      // Land where the change is legible: ACCUSE (the struck suspect bar) after a
      // strike, otherwise the board (the new card + meter tick).
      setTab(res.eliminatedSuspectIds.length > 0 ? 'accuse' : 'board');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doAccuse = async (suspectId: string, stake: number): Promise<void> => {
    try {
      await api.accuse({ suspectId, stake });
      audio.accuse();
      await loadCase();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!data) {
    return <div className="folder"><div className="plate">OPENING CASE FOLDER…</div>{err && <div className="err">{err}</div>}</div>;
  }

  const myUnfiled = data.shards.find((s) => s.visibility === 'mine' && peeled.has(s.shardId));
  const fileShard = data.shards.find((s) => s.shardId === fileShardId) ?? null;

  return (
    <>
      {tab === 'dossier' && (
        <>
          <Folder c={data.case} />
          <Dossier data={data} peeled={peeled} onPeel={onPeel} />
        </>
      )}
      {tab === 'board' && (board ? <Board data={board} /> : <div className="folder"><div className="plate">LOADING BOARD…</div></div>)}
      {tab === 'accuse' && <Accuse data={data} onAccuse={doAccuse} />}
      {tab === 'verdict' && (verdict ? <Verdict v={verdict} /> : <div className="folder"><div className="plate">LOADING…</div></div>)}

      {err && <div className="err">{err}</div>}

      {receipt && (
        <div className="receipt" role="status">
          <div className="receipt-head">
            <span>EVIDENCE FILED</span>
            <button className="receipt-x" onClick={() => setReceipt(null)} aria-label="dismiss">
              ✕
            </button>
          </div>
          <div className="receipt-meter">
            CASE METER {receipt.before}% → <b>{receipt.after}%</b>
          </div>
          {receipt.struck.length > 0 && (
            <div className="receipt-strike">
              ⚡ YOUR LINE STRUCK {receipt.struck.join(', ').toUpperCase()} — the board&apos;s favorite is
              off the list.
            </div>
          )}
          {receipt.lit && <div className="receipt-lit">🔴 RED STRING LIT — {receipt.lit}</div>}
          {receipt.struck.length === 0 && !receipt.lit && (
            <div className="receipt-lit">
              {receipt.duplicate ? 'Already on the board.' : 'Filed. The crowd can read your line now.'}
            </div>
          )}
        </div>
      )}

      {tab === 'dossier' && myUnfiled && (
        <button className="cta" onClick={() => setFileShardId(myUnfiled.shardId)}>
          FILE MY EVIDENCE →
        </button>
      )}

      {fileShard && fileShard.text !== undefined && (
        <FileModal shard={fileShard} onClose={() => setFileShardId(null)} onFile={doFile} />
      )}

      <nav className="nav">
        {(['dossier', 'board', 'accuse', 'verdict'] as Tab[]).map((t) => (
          <button key={t} data-active={tab === t} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>
    </>
  );
};

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
