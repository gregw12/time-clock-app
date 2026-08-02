import { useState, useEffect, useCallback } from "react";
import { Plus, Clock3, AlertTriangle, Trash2, XCircle, Shield, X, RotateCcw, Pencil, LogOut } from "lucide-react";

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

// ---------- admin helpers ----------
// Converts a stored "2:07:33 PM" display string into "14:07" for
// prefilling an <input type="time">.
function displayTimeToHHMM(str) {
  if (!str) return "";
  const m = String(str).match(/(\d+):(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const suffix = m[4].toUpperCase();
  if (suffix === "PM" && h !== 12) h += 12;
  if (suffix === "AM" && h === 12) h = 0;
  return String(h).padStart(2, "0") + ":" + m[2];
}
// Converts a stored "MM/dd/yyyy" date into "yyyy-MM-dd" for an
// <input type="date">.
function displayDateToISO(str) {
  if (!str) return "";
  const parts = String(str).split("/");
  if (parts.length !== 3) return "";
  return parts[2] + "-" + parts[0].padStart(2, "0") + "-" + parts[1].padStart(2, "0");
}
function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function AdminDashboard({ users, onUsersChange, onClose }) {
  const [authed, setAuthed] = useState(false);
  const [masterPin, setMasterPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("sessions");

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const defaults = defaultDateRange();
  const [payStart, setPayStart] = useState(defaults.start);
  const [payEnd, setPayEnd] = useState(defaults.end);
  const [paySummary, setPaySummary] = useState(null);
  const [payLoading, setPayLoading] = useState(false);

  const [shiftStart, setShiftStart] = useState(defaults.start);
  const [shiftEnd, setShiftEnd] = useState(defaults.end);
  const [shifts, setShifts] = useState(null);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [editingShift, setEditingShift] = useState(null); // shift object being edited
  const [editDate, setEditDate] = useState("");
  const [editTimeIn, setEditTimeIn] = useState("");
  const [editTimeOut, setEditTimeOut] = useState("");
  const [editBreak, setEditBreak] = useState("0");
  const [editNotes, setEditNotes] = useState("");

  const [dashError, setDashError] = useState("");

  async function handleAuth(e) {
    e.preventDefault();
    if (!masterPin || busy) return;
    setBusy(true);
    setAuthError("");
    try {
      const result = await jsonp({ action: "adminOpenSessions", masterPin });
      setSessions(result);
      setAuthed(true);
    } catch (err) {
      setAuthError(err.message || "Couldn't verify that PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function loadSessions() {
    setSessionsLoading(true);
    setDashError("");
    try {
      const result = await jsonp({ action: "adminOpenSessions", masterPin });
      setSessions(result);
    } catch (err) {
      setDashError(err.message || "Couldn't load open sessions.");
    } finally {
      setSessionsLoading(false);
    }
  }

  async function handleForceClockOut(userId, name) {
    if (!window.confirm(`Force-clock-out ${name}? This closes their session as of right now — you can fix the exact times afterward in Edit Shifts.`)) return;
    setBusy(true);
    setDashError("");
    try {
      await jsonp({ action: "adminForceClockOut", userId, masterPin });
      loadSessions();
    } catch (err) {
      setDashError(err.message || "Couldn't close that session.");
    } finally {
      setBusy(false);
    }
  }

  async function runPayPeriod() {
    setPayLoading(true);
    setDashError("");
    try {
      const result = await jsonp({ action: "payPeriodSummary", start: payStart, end: payEnd, masterPin });
      setPaySummary(result);
    } catch (err) {
      setDashError(err.message || "Couldn't load the pay period summary.");
    } finally {
      setPayLoading(false);
    }
  }

  async function runShiftSearch() {
    setShiftsLoading(true);
    setDashError("");
    setEditingShift(null);
    try {
      const result = await jsonp({ action: "adminListShifts", start: shiftStart, end: shiftEnd, masterPin });
      setShifts(result);
    } catch (err) {
      setDashError(err.message || "Couldn't load shifts.");
    } finally {
      setShiftsLoading(false);
    }
  }

  function openEdit(shift) {
    setEditingShift(shift);
    setEditDate(displayDateToISO(shift.date));
    setEditTimeIn(displayTimeToHHMM(shift.timeIn));
    setEditTimeOut(displayTimeToHHMM(shift.timeOut));
    const breakParts = String(shift.breakStr || "0:00:00").split(":").map(Number);
    setEditBreak(String((breakParts[0] || 0) * 60 + (breakParts[1] || 0)));
    setEditNotes(shift.notes || "");
  }

  async function saveEdit() {
    if (!editingShift || busy) return;
    setBusy(true);
    setDashError("");
    try {
      await jsonp({
        action: "adminEditShift",
        shiftId: editingShift.shiftId,
        date: editDate,
        timeIn: editTimeIn,
        timeOut: editTimeOut,
        breakMinutes: editBreak,
        notes: editNotes,
        masterPin,
      });
      setEditingShift(null);
      runShiftSearch();
    } catch (err) {
      setDashError(err.message || "Couldn't save that edit.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPin(userId, name) {
    const newPin = window.prompt(`New PIN for ${name} (4–8 digits):`);
    if (newPin === null) return;
    setBusy(true);
    setDashError("");
    try {
      await jsonp({ action: "adminResetPin", userId, newPin, masterPin });
      window.alert(`${name}'s PIN has been reset.`);
    } catch (err) {
      setDashError(err.message || "Couldn't reset that PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRosterDelete(userId, name) {
    if (!window.confirm(`Remove ${name} from the roster? Their past hours stay in the sheet.`)) return;
    setBusy(true);
    setDashError("");
    try {
      await jsonp({ action: "deleteUser", userId, masterPin });
      onUsersChange(users.filter((u) => u.id !== userId));
    } catch (err) {
      setDashError(err.message || "Couldn't remove that person.");
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div className="tc-body" style={{ textAlign: "center" }}>
        <Shield size={22} style={{ marginBottom: 8, color: "var(--secondary)" }} />
        <p className="tc-name" style={{ fontSize: 16 }}>Admin Dashboard</p>
        <div className="tc-since">Enter the master PIN</div>
        <form className="tc-unlock" onSubmit={handleAuth}>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            placeholder="Master PIN"
            value={masterPin}
            onChange={(e) => setMasterPin(e.target.value.replace(/\D/g, ""))}
          />
          <button type="submit" disabled={busy || !masterPin}>{busy ? "Checking…" : "Enter"}</button>
        </form>
        {authError && <div className="tc-error" style={{ padding: "8px 0 0" }}>{authError}</div>}
        <button className="tc-linklike" style={{ marginTop: 18 }} onClick={onClose}>
          <X size={11} strokeWidth={2.5} /> Back
        </button>
      </div>
    );
  }

  return (
    <div className="tc-admin">
      <div className="tc-admin-tabs">
        <button className={tab === "sessions" ? "active" : ""} onClick={() => { setTab("sessions"); loadSessions(); }}>Open Sessions</button>
        <button className={tab === "payperiod" ? "active" : ""} onClick={() => setTab("payperiod")}>Pay Period</button>
        <button className={tab === "shifts" ? "active" : ""} onClick={() => setTab("shifts")}>Edit Shifts</button>
        <button className={tab === "roster" ? "active" : ""} onClick={() => setTab("roster")}>Roster</button>
      </div>

      <div className="tc-admin-body">
        {dashError && <div className="tc-error" style={{ padding: "0 0 12px" }}>{dashError}</div>}

        {tab === "sessions" && (
          <>
            <div className="tc-admin-row-head">
              <span>Who's clocked in — 12+ hours is flagged stale</span>
              <button className="tc-admin-refresh" onClick={loadSessions} disabled={sessionsLoading}>
                {sessionsLoading ? "…" : "Refresh"}
              </button>
            </div>
            {sessions.length === 0 && !sessionsLoading && (
              <div className="tc-empty">No one's currently clocked in.</div>
            )}
            {sessions.map((s) => (
              <div key={s.userId} className={`tc-admin-item${s.stale ? " stale" : ""}`}>
                <div>
                  <div className="tc-admin-item-title">
                    {s.name} {s.onBreak && <span className="tc-stale-tag" style={{ color: "var(--secondary)", borderColor: "var(--secondary)" }}>ON BREAK</span>} {s.stale && <span className="tc-stale-tag">STALE</span>}
                  </div>
                  <div className="tc-admin-item-sub">
                    since {formatTimeShort(s.clockInAt)} · {s.hoursElapsed}h elapsed
                  </div>
                </div>
                <button className="tc-admin-action" onClick={() => handleForceClockOut(s.userId, s.name)} disabled={busy}>
                  <LogOut size={12} /> Force out
                </button>
              </div>
            ))}
          </>
        )}

        {tab === "payperiod" && (
          <>
            <div className="tc-admin-filters">
              <input type="date" value={payStart} onChange={(e) => setPayStart(e.target.value)} />
              <span>to</span>
              <input type="date" value={payEnd} onChange={(e) => setPayEnd(e.target.value)} />
              <button onClick={runPayPeriod} disabled={payLoading}>{payLoading ? "…" : "Run"}</button>
            </div>
            {paySummary && paySummary.length === 0 && <div className="tc-empty">No shifts in that range.</div>}
            {paySummary && paySummary.length > 0 && (
              <table className="tc-admin-table">
                <thead>
                  <tr><th>Name</th><th>Shifts</th><th>Hours</th></tr>
                </thead>
                <tbody>
                  {paySummary.map((p) => (
                    <tr key={p.email || p.name}>
                      <td>{p.name}</td>
                      <td>{p.shiftCount}</td>
                      <td>{p.totalHours}</td>
                    </tr>
                  ))}
                  <tr className="tc-admin-total-row">
                    <td>Total</td>
                    <td>{paySummary.reduce((sum, p) => sum + p.shiftCount, 0)}</td>
                    <td>{Math.round(paySummary.reduce((sum, p) => sum + p.totalHours, 0) * 100) / 100}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "shifts" && !editingShift && (
          <>
            <div className="tc-admin-filters">
              <input type="date" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
              <span>to</span>
              <input type="date" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
              <button onClick={runShiftSearch} disabled={shiftsLoading}>{shiftsLoading ? "…" : "Search"}</button>
            </div>
            {shifts && shifts.length === 0 && <div className="tc-empty">No shifts in that range.</div>}
            {shifts && shifts.map((s) => (
              <div key={s.shiftId} className="tc-admin-item">
                <div>
                  <div className="tc-admin-item-title">{s.name} — {s.date}</div>
                  <div className="tc-admin-item-sub">
                    {s.timeIn || "—"} → {s.timeOut || "open"} · {s.totalHours || 0}h
                  </div>
                </div>
                <button className="tc-admin-action" onClick={() => openEdit(s)}>
                  <Pencil size={12} /> Edit
                </button>
              </div>
            ))}
          </>
        )}

        {tab === "shifts" && editingShift && (
          <div className="tc-outform" style={{ margin: 0 }}>
            <label>{editingShift.name} — Date</label>
            <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            <label>Time In</label>
            <input type="time" value={editTimeIn} onChange={(e) => setEditTimeIn(e.target.value)} />
            <label>Time Out</label>
            <input type="time" value={editTimeOut} onChange={(e) => setEditTimeOut(e.target.value)} />
            <label>Break (minutes)</label>
            <input type="number" min="0" value={editBreak} onChange={(e) => setEditBreak(e.target.value)} />
            <label>Notes</label>
            <textarea rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            <div className="tc-outform-actions">
              <button className="cancel" onClick={() => setEditingShift(null)} disabled={busy}>Cancel</button>
              <button className="confirm" onClick={saveEdit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        )}

        {tab === "roster" && (
          <>
            {users.length === 0 && <div className="tc-empty">No one on the roster yet.</div>}
            {users.map((u) => (
              <div key={u.id} className="tc-admin-item">
                <div>
                  <div className="tc-admin-item-title">{u.name}</div>
                  <div className="tc-admin-item-sub">{u.email || "no email"}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="tc-admin-action" onClick={() => handleResetPin(u.id, u.name)} disabled={busy}>
                    <RotateCcw size={12} /> Reset PIN
                  </button>
                  <button className="tc-admin-action danger" onClick={() => handleRosterDelete(u.id, u.name)} disabled={busy}>
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <button className="tc-linklike" style={{ margin: "4px auto 16px" }} onClick={onClose}>
        <X size={11} strokeWidth={2.5} /> Exit admin dashboard
      </button>
    </div>
  );
}

// ---------- formatting ----------
// Pinned to Pacific so the app's clock/ledger always match the Sheet,
// regardless of the timezone the viewing device happens to be set to.
const APP_TIMEZONE = "America/Los_Angeles";

function pad(n) { return String(n).padStart(2, "0"); }
function formatClock(d) {
  return d.toLocaleTimeString("en-US", {
    timeZone: APP_TIMEZONE, hour12: true, hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}
function formatTimeShort(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: APP_TIMEZONE, hour12: true, hour: "numeric", minute: "2-digit",
  });
}
function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, month: "2-digit", day: "2-digit" });
}
function crossedMidnight(clockInIso, clockOutIso) {
  const inDate = new Date(clockInIso).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE });
  const outDate = new Date(clockOutIso).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE });
  return inDate !== outDate;
}
function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${pad(totalMin % 60)}m`;
}

export default function TimeClockApp() {
  const configured = APPS_SCRIPT_URL && !APPS_SCRIPT_URL.startsWith("PASTE_");

  const [users, setUsers] = useState([]);
  const [statuses, setStatuses] = useState({}); // userId -> {status, clockInAt}, populated only after unlock
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [now, setNow] = useState(new Date());
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPin, setNewPin] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(null);
  const [error, setError] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  // Nobody's status or history is visible until their own PIN is verified.
  // unlockedId tracks which single person is currently authenticated; pin
  // is kept in state afterward so punch/cancel don't need to re-ask.
  const [unlockedId, setUnlockedId] = useState(null);
  const [pin, setPin] = useState("");
  const [unlockError, setUnlockError] = useState("");

  // clock-out step: ask for notes before confirming
  const [showOutForm, setShowOutForm] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadHistory = useCallback(async (userId, pinValue) => {
    setHistoryLoading(true);
    try {
      const h = await jsonp({ action: "history", userId, pin: pinValue });
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
        if (data.users.length > 0) setSelectedId(data.users[0].id);
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
    setNotes("");
  }

  function selectUser(id) {
    setSelectedId(id);
    setError("");
    setUnlockedId(null);
    setPin("");
    setUnlockError("");
    setHistory([]);
    resetFormState();
  }

  async function handleUnlock(e) {
    e.preventDefault();
    if (!selectedId || busy || !pin) return;
    setBusy(true);
    setUnlockError("");
    try {
      const result = await jsonp({ action: "unlock", userId: selectedId, pin });
      setStatuses((prev) => ({ ...prev, [selectedId]: result }));
      setUnlockedId(selectedId);
      loadHistory(selectedId, pin);
    } catch (err) {
      setUnlockError(err.message || "Couldn't verify that PIN. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    const name = newName.trim();
    const email = newEmail.trim();
    const pinValue = newPin.trim();
    if (!name || !pinValue || busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await jsonp({ action: "addUser", name, email, pin: pinValue });
      setUsers((prev) => [...prev, user]);
      setNewName("");
      setNewEmail("");
      setNewPin("");
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
        pin,
        notes: wasIn ? notes : undefined,
      });
      setStatuses((prev) => ({ ...prev, [selectedId]: result }));
      setStamp({ type: wasIn ? "OUT" : "IN", key: Date.now() });
      resetFormState();
      loadHistory(selectedId, pin);
    } catch (err) {
      setError(err.message || "Couldn't save that punch. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doToggleBreak() {
    if (!selectedId || busy) return;
    setBusy(true);
    setError("");
    const wasOnBreak = statuses[selectedId]?.status === "break";
    try {
      const result = await jsonp({ action: "toggleBreak", userId: selectedId, pin });
      setStatuses((prev) => ({
        ...prev,
        [selectedId]: {
          ...prev[selectedId],
          status: result.status,
          breakStartAt: result.breakStartAt,
          accumulatedBreakMinutes: result.accumulatedBreakMinutes,
        },
      }));
      setStamp({ type: wasOnBreak ? "BACK" : "BREAK", key: Date.now() });
    } catch (err) {
      setError(err.message || "Couldn't update your break. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteUser() {
    if (!selectedUser || busy) return;
    const masterPin = window.prompt(
      `Enter the master PIN to remove ${selectedUser.name} from the roster. Their past hours stay in the sheet — this only removes them from the tap list.`
    );
    if (masterPin === null) return;
    setBusy(true);
    setError("");
    try {
      await jsonp({ action: "deleteUser", userId: selectedUser.id, masterPin });
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
        setUnlockedId(null);
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
      await jsonp({ action: "cancelPunch", userId: selectedId, pin });
      setStatuses((prev) => ({ ...prev, [selectedId]: { status: "out", clockInAt: null, breakStartAt: null, accumulatedBreakMinutes: 0 } }));
      resetFormState();
      loadHistory(selectedId);
    } catch (err) {
      setError(err.message || "Couldn't cancel that clock-in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = getUserById(users, selectedId);
  const selectedStatus = statuses[selectedId] || { status: "out", clockInAt: null, breakStartAt: null, accumulatedBreakMinutes: 0 };
  const clockedIn = selectedStatus.status === "in";
  const onBreak = selectedStatus.status === "break";
  const breakAlreadyTaken = (selectedStatus.accumulatedBreakMinutes || 0) > 0;
  const elapsedMs = (clockedIn || onBreak) && selectedStatus.clockInAt ? now - new Date(selectedStatus.clockInAt) : 0;
  const breakElapsedMs = onBreak && selectedStatus.breakStartAt ? now - new Date(selectedStatus.breakStartAt) : 0;

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
          border-radius: 16px;
          overflow: hidden;
        }
        .tc-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--hairline);
          background: var(--surface-alt);
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
          border: 3px solid var(--surface-alt);
        }
        .tc-badge {
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.04em;
          padding: 7px 12px;
          border-radius: 8px;
          border: 1px solid var(--hairline);
          background: var(--surface-alt);
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
        }
        .tc-badge:hover { border-color: var(--secondary-dim); color: var(--text); }
        .tc-badge.active {
          border-color: var(--secondary);
          color: var(--bg);
          background: var(--secondary);
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
          border-radius: 8px;
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
          border-radius: 8px;
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
        .tc-dot.in { background: var(--secondary); }
        .tc-dot.out { background: var(--primary); }
        .tc-dot.break { background: transparent; border: 2px solid var(--secondary); box-sizing: border-box; }
        .tc-since { font-size: 12px; color: var(--text-muted); margin-bottom: 22px; min-height: 16px; }
        .tc-unlock { display: flex; gap: 8px; max-width: 220px; margin: 0 auto; }
        .tc-unlock input {
          flex: 1;
          min-width: 0;
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          border-radius: 6px;
          color: var(--text);
          padding: 10px 12px;
          font-family: 'Space Mono', monospace;
          font-size: 14px;
          text-align: center;
        }
        .tc-unlock input:focus { outline: 1px solid var(--secondary); border-color: var(--secondary); }
        .tc-unlock button {
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          background: var(--secondary);
          color: var(--bg);
          border: none;
          border-radius: 6px;
          padding: 0 16px;
          cursor: pointer;
        }
        .tc-unlock button:disabled { opacity: 0.5; cursor: default; }
        .tc-punch {
          width: 150px;
          height: 150px;
          border-radius: 50%;
          border: 3px solid var(--hairline);
          background: var(--surface-alt);
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
          transition: transform 0.08s ease, border-color 0.2s ease, background 0.2s ease;
        }
        .tc-punch.in { border-color: var(--secondary); color: var(--secondary); background: rgba(145,197,235,0.10); }
        .tc-punch.out { border-color: var(--primary); color: var(--secondary); background: rgba(28,66,122,0.15); }
        .tc-punch.break { border-color: var(--secondary); color: var(--bg); background: var(--secondary); font-size: 12px; }
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
        .tc-action-gap {
          margin-top: 22px;
          padding-top: 14px;
          border-top: 1px solid var(--hairline);
        }
        .tc-action-gap .tc-linklike { margin-top: 0; }

        .tc-outform {
          margin-top: 4px;
          padding: 16px;
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          border-radius: 8px;
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
          border-radius: 8px;
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
          border-radius: 8px;
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
          border-radius: 8px;
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
        .tc-plusday { color: var(--secondary); font-weight: 700; }
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

        .tc-admin-toggle {
          background: none;
          border: 1px solid var(--hairline);
          border-radius: 6px;
          color: var(--text-muted);
          padding: 5px 7px;
          cursor: pointer;
          display: flex;
          align-items: center;
        }
        .tc-admin-toggle:hover { color: var(--secondary); border-color: var(--secondary-dim); }

        .tc-admin { padding: 16px 18px 4px; }
        .tc-admin-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 16px;
        }
        .tc-admin-tabs button {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.02em;
          padding: 7px 10px;
          border-radius: 6px;
          border: 1px solid var(--hairline);
          background: var(--surface-alt);
          color: var(--text-muted);
          cursor: pointer;
        }
        .tc-admin-tabs button.active { border-color: var(--secondary); color: var(--bg); background: var(--secondary); }
        .tc-admin-body { min-height: 120px; }

        .tc-admin-row-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 10px;
        }
        .tc-admin-refresh {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          color: var(--text);
          border-radius: 6px;
          padding: 5px 10px;
          cursor: pointer;
        }

        .tc-admin-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 10px 0;
          border-top: 1px solid var(--hairline);
        }
        .tc-admin-item:first-child { border-top: none; }
        .tc-admin-item.stale { background: rgba(255,93,74,0.06); margin: 0 -18px; padding: 10px 18px; }
        .tc-admin-item-title { font-size: 13px; font-weight: 600; }
        .tc-admin-item-sub { font-size: 11px; color: var(--text-muted); font-family: 'Space Mono', monospace; margin-top: 2px; }
        .tc-stale-tag {
          font-family: 'Space Mono', monospace;
          font-size: 9px;
          color: var(--red);
          border: 1px solid var(--red);
          border-radius: 4px;
          padding: 1px 5px;
          margin-left: 6px;
          vertical-align: middle;
        }
        .tc-admin-action {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          color: var(--text);
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          white-space: nowrap;
        }
        .tc-admin-action:hover { border-color: var(--secondary); color: var(--secondary); }
        .tc-admin-action.danger:hover { border-color: var(--red); color: var(--red); }
        .tc-admin-action:disabled { opacity: 0.5; cursor: default; }

        .tc-admin-filters {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 14px;
          font-size: 12px;
          color: var(--text-muted);
        }
        .tc-admin-filters input[type="date"] {
          background: var(--surface-alt);
          border: 1px solid var(--hairline);
          border-radius: 6px;
          color: var(--text);
          padding: 7px 8px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
        }
        .tc-admin-filters button {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          background: var(--secondary);
          color: var(--bg);
          border: none;
          border-radius: 6px;
          padding: 7px 12px;
          cursor: pointer;
        }

        .tc-admin-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .tc-admin-table th {
          text-align: left;
          font-family: 'Space Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 6px 4px;
          border-bottom: 1px solid var(--hairline);
        }
        .tc-admin-table td {
          padding: 8px 4px;
          border-bottom: 1px solid var(--hairline);
        }
        .tc-admin-total-row td {
          font-weight: 700;
          color: var(--secondary);
          border-bottom: none;
          border-top: 2px solid var(--hairline);
        }

        @media (prefers-reduced-motion: reduce) {
          .tc-stamp { animation: none; opacity: 0; }
          .tc-punch { transition: none; }
        }
      `}</style>

      <div className="tc-card">
        <div className="tc-header">
          <span className="tc-eyebrow">Time Clock</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="tc-led">{formatClock(now)}</span>
            {configured && (
              <button
                className="tc-admin-toggle"
                onClick={() => setShowAdmin((v) => !v)}
                title="Admin dashboard"
              >
                <Shield size={14} />
              </button>
            )}
          </div>
        </div>

        {showAdmin ? (
          <AdminDashboard
            users={users}
            onUsersChange={setUsers}
            onClose={() => setShowAdmin(false)}
          />
        ) : !configured ? (
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
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Choose a PIN (4–8 digits)"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                />
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

              {selectedUser && unlockedId !== selectedUser.id && (
                <>
                  <div
                    className="tc-avatar tc-avatar-lg"
                    style={{ background: colorForUser(selectedUser.id) }}
                  >
                    {initialsForName(selectedUser.name)}
                  </div>
                  <p className="tc-name">{selectedUser.name}</p>
                  <div className="tc-since">Enter your PIN to view your time clock</div>
                  <form className="tc-unlock" onSubmit={handleUnlock}>
                    <input
                      autoFocus
                      type="password"
                      inputMode="numeric"
                      placeholder="PIN"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    />
                    <button type="submit" disabled={busy || !pin}>
                      {busy ? "Checking…" : "Unlock"}
                    </button>
                  </form>
                  {unlockError && <div className="tc-error" style={{ padding: "8px 0 0" }}>{unlockError}</div>}
                </>
              )}

              {selectedUser && unlockedId === selectedUser.id && (
                <>
                  <div
                    className="tc-avatar tc-avatar-lg"
                    style={{ background: colorForUser(selectedUser.id) }}
                  >
                    {initialsForName(selectedUser.name)}
                  </div>
                  <p className="tc-name">{selectedUser.name}</p>
                  <div className="tc-status-row">
                    <span className={`tc-dot ${onBreak ? "break" : clockedIn ? "in" : "out"}`} />
                    {onBreak ? "on break" : clockedIn ? "clocked in" : "clocked out"}
                  </div>
                  <div className="tc-since">
                    {onBreak && selectedStatus.breakStartAt &&
                      `break since ${formatTimeShort(selectedStatus.breakStartAt)} · ${formatDuration(breakElapsedMs)}`}
                    {clockedIn && !onBreak && selectedStatus.clockInAt &&
                      `since ${formatTimeShort(selectedStatus.clockInAt)} · ${formatDuration(elapsedMs)}`}
                    {!clockedIn && !onBreak && "ready to punch in"}
                  </div>

                  {!showOutForm && !onBreak && (
                    <button
                      className={`tc-punch ${clockedIn ? "in" : "out"}`}
                      onClick={handlePunchTap}
                      disabled={busy || loading}
                    >
                      {clockedIn ? "PUNCH OUT" : "PUNCH IN"}
                    </button>
                  )}

                  {!showOutForm && onBreak && (
                    <button className="tc-punch break" onClick={doToggleBreak} disabled={busy}>
                      BACK FROM BREAK
                    </button>
                  )}

                  {!showOutForm && clockedIn && !onBreak && !breakAlreadyTaken && (
                    <div className="tc-action-gap">
                      <button className="tc-linklike" onClick={doToggleBreak} disabled={busy}>
                        <Clock3 size={11} strokeWidth={2.5} />
                        Start a break
                      </button>
                    </div>
                  )}

                  {!showOutForm && clockedIn && !onBreak && breakAlreadyTaken && (
                    <div className="tc-since tc-action-gap" style={{ marginBottom: 8, fontSize: 11 }}>
                      Break taken · {Math.round(selectedStatus.accumulatedBreakMinutes)}m
                    </div>
                  )}

                  {!showOutForm && (clockedIn || onBreak) && (
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
                        <span>
                          {formatTimeShort(h.clockIn)} → {formatTimeShort(h.clockOut)}
                          {crossedMidnight(h.clockIn, h.clockOut) && <span className="tc-plusday"> +1</span>}
                        </span>
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