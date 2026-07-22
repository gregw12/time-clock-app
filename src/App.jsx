import { useState, useEffect, useCallback } from "react";
import { Plus, Clock3, AlertTriangle, Trash2, XCircle } from "lucide-react";

// ---------------------------------------------------------------------
// PASTE YOUR DEPLOYED APPS SCRIPT WEB APP URL HERE (ends in /exec)
// See TimeClock-AppsScript.gs for the backend + deployment steps.
// ---------------------------------------------------------------------
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxz8DhiXxbN6T_9UquHhfrNAXXpXX9JVltfZXhd6nU8qjqXOEHOhly0fWPlw7KEMq-J/exec";

// ---------- API helper (JSONP — Apps Script can't set CORS headers, ----------
// ---------- so fetch() gets blocked; a <script> tag isn't subject to CORS) ----------
function jsonp(params) {
  return new Promise((resolve, reject) => {
    const callbackName = "tcCallback_" + Math.random().toString(36).slice(2);
    const clean = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) clean[k] = v;
    });
    const qs = new URLSearchParams({ ...clean, callback: callbackName }).toString();

    const script = document.createElement("script");
    script.src = `${APPS_SCRIPT_URL}?${qs}`;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Request timed out"));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (data) => {
      cleanup();
      if (data && data.error) reject(new Error(data.error));
      else resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Request failed"));
    };
    document.body.appendChild(script);
  });
}
function getUserById(users, id) {
  return users.find((u) => u.id === id) || null;
}

// ---------- avatar identity ----------
// A curated palette (not just brand blues) so people stay visually distinct
// even with a larger roster; deterministic per user so it's stable across
// sessions/devices without storing anything extra.
const AVATAR_PALETTE = [
  "#91c5eb", "#f2a154", "#7fd4a3", "#e08bd9", "#c98bd9",
  "#f2d060", "#6fd1c7", "#e8896b", "#a3b8f0", "#d97ba0",
];
function colorForUser(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initialsForName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------- formatting ----------
// Pinned to Pacific so the app's clock/ledger always match the Sheet,
// regardless of the timezone the viewing device happens to be set to.
const APP_TIMEZONE = "America/Los_Angeles";

function pad(n) { return String(n).padStart(2, "0"); }
function formatClock(d) {
  return d.toLocaleTimeString("en-US", {
    timeZone: APP_TIMEZONE, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function formatTimeShort(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit" });
}
function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, month: "2-digit", day: "2-digit" });
}
function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${pad(totalMin % 60)}m`;
}

export default function TimeClockApp() {
  const configured = APPS_SCRIPT_URL && !APPS_SCRIPT_URL.startsWith("PASTE_");

  const [users, setUsers] = useState([]);
  const [statuses, setStatuses] = useState({}); // userId -> {status, clockInAt}
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [now, setNow] = useState(new Date());
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(null);
  const [error, setError] = useState("");

  // clock-out step: ask for break + notes before confirming
  const [showOutForm, setShowOutForm] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadHistory = useCallback(async (userId) => {
    setHistoryLoading(true);
    try {
      const h = await jsonp({ action: "history", userId });
      setHistory(h);
    } catch {
      setError("Couldn't load the ledger for this person.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await jsonp({ action: "bootstrap" });
        setUsers(data.users);
        setStatuses(data.statuses);
        if (data.users.length > 0) {
          setSelectedId(data.users[0].id);
          loadHistory(data.users[0].id);
        }
      } catch {
        setError("Couldn't reach the sheet. Check the Web App URL and deployment access.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  function resetFormState() {
    setShowOutForm(false);
    setBreakMinutes("0");
    setNotes("");
  }

  function selectUser(id) {
    setSelectedId(id);
    setError("");
    resetFormState();
    loadHistory(id);
  }

  async function handleAddUser(e) {
    e.preventDefault();
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await jsonp({ action: "addUser", name, email });
      const updatedUsers = [...users, user];
      setUsers(updatedUsers);
      setStatuses((prev) => ({ ...prev, [user.id]: { status: "out", clockInAt: null } }));
      setNewName("");
      setNewEmail("");
      setAddingUser(false);
      selectUser(user.id);
    } catch (err) {
      setError(err.message || "Couldn't add that person. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Clock-in fires immediately; clock-out opens the break/notes step first.
  function handlePunchTap() {
    if (!selectedId || busy) return;
    const clockedIn = statuses[selectedId]?.status === "in";
    if (clockedIn) {
      setShowOutForm(true);
    } else {
      doPunch();
    }
  }

  async function doPunch() {
    if (!selectedId || busy) return;
    setBusy(true);
    setError("");
    const wasIn = statuses[selectedId]?.status === "in";
    try {
      const result = await jsonp({
        action: "punch",
        userId: selectedId,
        breakMinutes: wasIn ? breakMinutes : undefined,
        notes: wasIn ? notes : undefined,
      });
      setStatuses((prev) => ({ ...prev, [selectedId]: result }));
      setStamp({ type: wasIn ? "OUT" : "IN", key: Date.now() });
      resetFormState();
      loadHistory(selectedId);
    } catch (err) {
      setError(err.message || "Couldn't save that punch. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteUser() {
    if (!selectedUser || busy) return;
    const passcode = window.prompt(
      `Enter the admin passcode to remove ${selectedUser.name} from the roster. Their past hours stay in the sheet — this only removes them from the tap list.`
    );
    if (passcode === null) return;
    setBusy(true);
    setError("");
    try {
      await jsonp({ action: "deleteUser", userId: selectedUser.id, passcode });
      const remaining = users.filter((u) => u.id !== selectedUser.id);
      setUsers(remaining);
      setStatuses((prev) => {
        const next = { ...prev };
        delete next[selectedUser.id];
        return next;
      });
      if (remaining.length > 0) {
        selectUser(remaining[0].id);
      } else {
        setSelectedId(null);
        setHistory([]);
      }
    } catch (err) {
      setError(err.message || "Couldn't remove that person. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPunch() {
    if (!selectedId || busy) return;
    const confirmed = window.confirm("Cancel this clock-in? It won't be logged as a shift.");
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      await jsonp({ action: "cancelPunch", userId: selectedId });
      setStatuses((prev) => ({ ...prev, [selectedId]: { status: "out", clockInAt: null } }));
      resetFormState();
      loadHistory(selectedId);
    } catch (err) {
      setError(err.message || "Couldn't cancel that clock-in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = getUserById(users, selectedId);
  const selectedStatus = statuses[selectedId] || { status: "out", clockInAt: null };
  const clockedIn = selectedStatus.status === "in";
  const elapsedMs = clockedIn && selectedStatus.clockInAt ? now - new Date(selectedStatus.clockInAt) : 0;

  return (
    <div className="tc-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');

        .tc-root {
          --bg: #0d0e20;
          --surface: #121a33;
          --surface-alt: #1a2748;
          --hairline: #2a3a63;
          --primary: #1c427a;
          --secondary: #91c5eb;
          --secondary-dim: #4f7aa8;
          --red: #ff5d4a;
          --text: #f1f1f1;
          --text-muted: #9aa6c0;
          font-family: 'Inter', sans-serif;
          background: var(--bg);
          color: var(--text);
          min-height: 100%;
          padding: 32px 16px;
          display: flex;
          justify-content: center;
        }
        .tc-card {
          width: 100%;
          max-width: 460px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: 4px;
          overflow: hidden;
        }
        .tc-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--hairline);
          background: linear-gradient(180deg, var(--surface-alt), var(--surface));
        }
        .tc-eyebrow {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .tc-led {
          font-family: 'Space Mono', monospace;
          font-size: 20px;
          font-weight: 700;
          color: var(--secondary);
          text-shadow: 0 0 8px rgba(145,197,235,0.45);
          letter-spacing: 0.05em;
        }
        .tc-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 16px 20px;
          border-bottom: 1px solid var(--hairline);
        }
        .tc-avatar {
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-family: 'Space Mono', monospace;
          font-weight: 700;
          color: var(--bg);
          flex-shrink: 0;
        }
        .tc-avatar-sm { width: 18px; height: 18px; font-size: 8px; }
        .tc-avatar-lg {
          width: 56px;
          height: 56px;
          font-size: 20px;
          margin: 0 auto 12px;
          box-shadow: 0 0 0 3px var(--surface-alt);
        }
        .tc-badge {
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.04em;
          padding: 7px 12px;
          border-radius: 3px;
          border: 1px solid var(--hairline);
          background: var(--surface-alt);
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: border-color 0.15s ease, color 0.15s ease;
        }
        .tc-badge:hover { border-color: var(--secondary-dim); color: var(--text); }
        .tc-badge.active {
          border-color: var(--secondary);
          color: var(--secondary);
          background: rgba(145,197,235,0.08);
        }
        .tc-badge.add { color: var(--text-muted); }
        .tc-add-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 0 20px 16px;
        }
        .tc-add-form-row { display: flex; gap: 8px; }
        .tc-add-form input {
          flex: 1;
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          border-radius: 3px;
          color: var(--text);
          padding: 8px 10px;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
        }
        .tc-add-form input:focus { outline: 1px solid var(--secondary); border-color: var(--secondary); }
        .tc-add-form button {
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          background: var(--secondary);
          color: var(--bg);
          border: none;
          border-radius: 3px;
          padding: 0 14px;
          cursor: pointer;
          font-weight: 700;
        }
        .tc-body { padding: 22px 20px 24px; text-align: center; position: relative; }
        .tc-name { font-size: 19px; font-weight: 600; margin: 0 0 6px; }
        .tc-status-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .tc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
        .tc-dot.in { background: var(--secondary); box-shadow: 0 0 6px var(--secondary); }
        .tc-dot.out { background: var(--primary); }
        .tc-since { font-size: 12px; color: var(--text-muted); margin-bottom: 22px; min-height: 16px; }
        .tc-punch {
          width: 150px;
          height: 150px;
          border-radius: 50%;
          border: 3px solid var(--hairline);
          background: radial-gradient(circle at 35% 30%, var(--surface-alt), var(--bg) 78%);
          color: var(--text);
          font-family: 'Space Mono', monospace;
          font-size: 14px;
          letter-spacing: 0.08em;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
          transition: transform 0.08s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .tc-punch.in { border-color: var(--secondary); color: var(--secondary); box-shadow: 0 0 22px rgba(145,197,235,0.20); }
        .tc-punch.out { border-color: var(--primary); color: var(--secondary); box-shadow: 0 0 22px rgba(28,66,122,0.35); }
        .tc-punch:active { transform: scale(0.96); }
        .tc-punch:disabled { opacity: 0.5; cursor: default; }
        .tc-punch:focus-visible { outline: 2px solid var(--secondary); outline-offset: 3px; }

        .tc-linklike {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          margin: 12px auto 0;
          background: none;
          border: none;
          color: var(--text-muted);
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.04em;
          cursor: pointer;
          padding: 4px;
        }
        .tc-linklike:hover { color: var(--secondary); }
        .tc-linklike.subtle { opacity: 0.55; }
        .tc-linklike.subtle:hover { opacity: 1; color: var(--red); }
        .tc-linklike:disabled { opacity: 0.35; cursor: default; }

        .tc-outform {
          margin-top: 4px;
          padding: 16px;
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          border-radius: 4px;
          text-align: left;
        }
        .tc-outform label {
          display: block;
          font-family: 'Space Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .tc-outform input, .tc-outform textarea {
          width: 100%;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: 3px;
          color: var(--text);
          padding: 8px 10px;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          margin-bottom: 12px;
          resize: none;
        }
        .tc-outform input:focus, .tc-outform textarea:focus { outline: 1px solid var(--secondary); border-color: var(--secondary); }
        .tc-outform-actions { display: flex; gap: 8px; }
        .tc-outform-actions button {
          flex: 1;
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          border-radius: 3px;
          padding: 10px;
          cursor: pointer;
          border: 1px solid var(--hairline);
        }
        .tc-outform-actions .confirm { background: var(--secondary); color: var(--bg); border: none; }
        .tc-outform-actions .cancel { background: transparent; color: var(--text-muted); }

        .tc-stamp {
          position: absolute;
          top: 46%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-14deg) scale(1.4);
          font-family: 'Space Mono', monospace;
          font-weight: 700;
          font-size: 26px;
          letter-spacing: 0.12em;
          border: 3px solid var(--secondary);
          color: var(--secondary);
          padding: 6px 16px;
          border-radius: 4px;
          pointer-events: none;
          opacity: 0;
          animation: tc-stamp-in 0.9s ease-out forwards;
        }
        @keyframes tc-stamp-in {
          0% { opacity: 0; transform: translate(-50%, -50%) rotate(-14deg) scale(2.2); }
          15% { opacity: 0.95; transform: translate(-50%, -50%) rotate(-14deg) scale(1); }
          70% { opacity: 0.95; }
          100% { opacity: 0; transform: translate(-50%, -50%) rotate(-14deg) scale(1); }
        }

        .tc-ledger { border-top: 1px solid var(--hairline); margin-top: 18px; }
        .tc-ledger-head {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          color: var(--text-muted);
          text-transform: uppercase;
          padding: 14px 20px 8px;
        }
        .tc-row {
          display: flex;
          justify-content: space-between;
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          padding: 7px 20px;
          border-top: 1px solid rgba(42,58,99,0.5);
          color: var(--text-muted);
        }
        .tc-row span.tc-dur { color: var(--text); }
        .tc-empty { padding: 24px 20px 28px; text-align: center; color: var(--text-muted); font-size: 13px; }
        .tc-error {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12px;
          color: var(--red);
          padding: 0 20px 12px;
          text-align: center;
        }
        .tc-setup {
          padding: 28px 20px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.6;
        }
        .tc-setup code {
          font-family: 'Space Mono', monospace;
          color: var(--secondary);
          font-size: 12px;
        }
        @media (prefers-reduced-motion: reduce) {
          .tc-stamp { animation: none; opacity: 0; }
          .tc-punch { transition: none; }
        }
      `}</style>

      <div className="tc-card">
        <div className="tc-header">
          <span className="tc-eyebrow">Time Clock</span>
          <span className="tc-led">{formatClock(now)}</span>
        </div>

        {!configured ? (
          <div className="tc-setup">
            <AlertTriangle size={20} style={{ marginBottom: 8, color: "var(--secondary)" }} />
            <div>
              Set <code>APPS_SCRIPT_URL</code> at the top of this file to your deployed
              Apps Script Web App URL, then reload.
            </div>
          </div>
        ) : (
          <>
            <div className="tc-badges">
              {loading && <span className="tc-eyebrow">loading roster…</span>}
              {!loading && users.map((u) => (
                <button
                  key={u.id}
                  className={`tc-badge${u.id === selectedId ? " active" : ""}`}
                  onClick={() => selectUser(u.id)}
                >
                  <span className="tc-avatar tc-avatar-sm" style={{ background: colorForUser(u.id) }}>
                    {initialsForName(u.name)}
                  </span>
                  {u.name}
                </button>
              ))}
              {!loading && (
                <button className="tc-badge add" onClick={() => setAddingUser((v) => !v)}>
                  <Plus size={12} strokeWidth={2.5} />
                  New
                </button>
              )}
            </div>

            {addingUser && (
              <form className="tc-add-form" onSubmit={handleAddUser}>
                <div className="tc-add-form-row">
                  <input
                    autoFocus
                    placeholder="Name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <button type="submit" disabled={busy}>Add to roster</button>
              </form>
            )}

            <div className="tc-body">
              {!loading && users.length === 0 && !addingUser && (
                <div className="tc-empty">
                  <Clock3 size={22} style={{ marginBottom: 8, opacity: 0.6 }} />
                  <div>No one's on the roster yet. Tap "New" to add someone.</div>
                </div>
              )}

              {selectedUser && (
                <>
                  <div
                    className="tc-avatar tc-avatar-lg"
                    style={{ background: colorForUser(selectedUser.id) }}
                  >
                    {initialsForName(selectedUser.name)}
                  </div>
                  <p className="tc-name">{selectedUser.name}</p>
                  <div className="tc-status-row">
                    <span className={`tc-dot ${clockedIn ? "in" : "out"}`} />
                    {clockedIn ? "clocked in" : "clocked out"}
                  </div>
                  <div className="tc-since">
                    {clockedIn && selectedStatus.clockInAt &&
                      `since ${formatTimeShort(selectedStatus.clockInAt)} · ${formatDuration(elapsedMs)}`}
                    {!clockedIn && "ready to punch in"}
                  </div>

                  {!showOutForm && (
                    <button
                      className={`tc-punch ${clockedIn ? "in" : "out"}`}
                      onClick={handlePunchTap}
                      disabled={busy || loading}
                    >
                      {clockedIn ? "PUNCH OUT" : "PUNCH IN"}
                    </button>
                  )}

                  {!showOutForm && clockedIn && (
                    <button className="tc-linklike" onClick={handleCancelPunch} disabled={busy}>
                      <XCircle size={11} strokeWidth={2.5} />
                      Cancel this clock-in
                    </button>
                  )}

                  {!showOutForm && (
                    <button className="tc-linklike subtle" onClick={handleDeleteUser} disabled={busy}>
                      <Trash2 size={11} strokeWidth={2.5} />
                      Remove {selectedUser.name} from roster
                    </button>
                  )}

                  {showOutForm && (
                    <div className="tc-outform">
                      <label>Break (minutes)</label>
                      <input
                        type="number"
                        min="0"
                        value={breakMinutes}
                        onChange={(e) => setBreakMinutes(e.target.value)}
                      />
                      <label>Notes (optional)</label>
                      <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="What did you work on?"
                      />
                      <div className="tc-outform-actions">
                        <button className="cancel" onClick={resetFormState} disabled={busy}>
                          Cancel
                        </button>
                        <button className="confirm" onClick={doPunch} disabled={busy}>
                          {busy ? "Saving…" : "Confirm Clock Out"}
                        </button>
                      </div>
                    </div>
                  )}

                  {stamp && !showOutForm && <span key={stamp.key} className="tc-stamp">{stamp.type}</span>}

                  <div className="tc-ledger">
                    <div className="tc-ledger-head">Ledger</div>
                    {historyLoading && (
                      <div className="tc-row" style={{ justifyContent: "center" }}>loading…</div>
                    )}
                    {!historyLoading && history.length > 0 && history.map((h, i) => (
                      <div className="tc-row" key={i}>
                        <span>{formatDateShort(h.clockIn)}</span>
                        <span>{formatTimeShort(h.clockIn)} → {formatTimeShort(h.clockOut)}</span>
                        <span className="tc-dur">
                          {formatDuration(new Date(h.clockOut) - new Date(h.clockIn))}
                        </span>
                      </div>
                    ))}
                    {!historyLoading && history.length === 0 && (
                      <div className="tc-row" style={{ justifyContent: "center" }}>no punches yet</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="tc-error">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
