import { useMemo, useState, useEffect } from "react";

type Status =
  | "ready"
  | "saved successfully"
  | "injection started"
  | "validating key..."
  | "invalid key"
  | "injecting..."
  | "RL Running"
  | "RL Closed"
  | string;

interface UserInfo {
  userId: string | null;
  discordId: string | null;
  epicId: string | null;
  username: string | null;
  globalName: string | null;
  logins?: number;
}

interface KeyValidationResponse {
  status: string;
  user: UserInfo | null;
}

const THEMES = [
  { id: "phantom",   label: "Phantom",   color: "#a855f7" },
  { id: "glacier",   label: "Glacier",   color: "#38bdf8" },
  { id: "inferno",   label: "Inferno",   color: "#f97316" },
  { id: "matrix",    label: "Matrix",    color: "#00ff41" },
  { id: "synthwave", label: "Synthwave", color: "#f72585" },
  { id: "eclipse",   label: "Eclipse",   color: "#fbbf24" },
] as const;

type ThemeId = typeof THEMES[number]["id"];

const LS_KEYS = {
  spoofed: "rlidentity.spoofedUsername",
  apiKey: "rlidentity.apiKey",
  minimizeToTray: "rlidentity.minimizeToTray",
  platform: "rlidentity.platform",
  autoInject: "rlidentity.autoInject",
  theme: "rlidentity.theme",
} as const;

const GITHUB_URL = "https://git.rlidentity.me/bits/rlidentity";
const FAQ_URL = "https://rlidentity.me/#faq";

function isTauriRuntime() {
  return typeof window !== "undefined" && typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
}

async function tryWindowApi(action: (win: any) => Promise<void>) {
  if (!isTauriRuntime()) return;
  const mod: any = await import("@tauri-apps/api/window");
  const win = mod.getCurrentWindow();
  await action(win);
}

async function tryInvoke<T>(cmd: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) return null;
  const mod: any = await import("@tauri-apps/api/core");
  return (await mod.invoke(cmd, args)) as T;
}

async function openUrl(url: string) {
  const fallback = () => window.open(url, "_blank", "noopener,noreferrer");
  if (!isTauriRuntime()) return fallback();
  try {
    const mod: any = await import("@tauri-apps/plugin-opener");
    if (typeof mod.openUrl === "function") {
      await mod.openUrl(url);
      return;
    }
    fallback();
  } catch {
    fallback();
  }
}

export default function App() {
  const initialApiKey     = useMemo(() => localStorage.getItem(LS_KEYS.apiKey) ?? "", []);
  const initialSpoofed    = useMemo(() => localStorage.getItem(LS_KEYS.spoofed) ?? "", []);
  const initialMinToTray  = useMemo(() => localStorage.getItem(LS_KEYS.minimizeToTray) === "true", []);
  const initialPlatform   = useMemo(() => localStorage.getItem(LS_KEYS.platform) ?? "Epic", []);
  const initialAutoInject = useMemo(() => localStorage.getItem(LS_KEYS.autoInject) === "true", []);
  const initialTheme      = useMemo(() => (localStorage.getItem(LS_KEYS.theme) ?? "phantom") as ThemeId, []);

  const [apiKey, setApiKey]               = useState(initialApiKey);
  const [spoofedUsername, setSpoofedUsername] = useState(initialSpoofed);
  const [isAuthorized, setIsAuthorized]   = useState(false);
  const [isRevoked, setIsRevoked]         = useState(false);
  const [userData, setUserData]           = useState<UserInfo | null>(null);

  const [status, setStatus]               = useState<Status>("ready");
  const [rlStatus, setRlStatus]           = useState("Checking...");
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [logsOpen, setLogsOpen]           = useState(false);
  const [lastLog, setLastLog]             = useState("");
  const [minimizeToTray, setMinimizeToTray] = useState(initialMinToTray);
  const [platform, setPlatform]           = useState(initialPlatform);
  const [autoInject, setAutoInject]       = useState(initialAutoInject);
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [theme, setTheme]                 = useState<ThemeId>(initialTheme);

  // Update modal
  const [pendingUpdate, setPendingUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(null);

  // Easter egg
  const [debugOpen, setDebugOpen]   = useState(false);
  const [logoClicks, setLogoClicks] = useState(0);

  const handleLogoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLogoClicks(prev => prev + 1);
  };

  useEffect(() => {
    if (logoClicks >= 5) {
      setDebugOpen(true);
      setLogoClicks(0);
    }
    const timer = setTimeout(() => {
      if (logoClicks > 0) setLogoClicks(0);
    }, 1000);
    return () => clearTimeout(timer);
  }, [logoClicks]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(LS_KEYS.theme, theme);
  }, [theme]);

  // Startup
  useEffect(() => {
    if (initialApiKey) authorize(initialApiKey);
    syncAssetsAndCheckUpdates();
  }, []);

  async function syncAssetsAndCheckUpdates() {
    if (!isTauriRuntime()) return;
    try {
      await tryInvoke("download_assets");
    } catch (e) {
      console.error("Failed to sync assets:", e);
    }
    checkForUpdates();
  }

  async function checkForUpdates() {
    if (!isTauriRuntime()) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setPendingUpdate({
          version: update.version,
          install: async () => {
            setStatus("Updating...");
            await update.downloadAndInstall();
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
          },
        });
      }
    } catch (e) {
      console.error("Failed to check for updates:", e);
    }
  }

  // Revoked bg
  useEffect(() => {
    document.body.classList.toggle("revoked-bg", isRevoked);
  }, [isRevoked]);

  // Poll RL status + auto-inject
  useEffect(() => {
    if (!isAuthorized || isRevoked) return;
    const interval = setInterval(async () => {
      try {
        const res = await tryInvoke<{ is_running: boolean }>("check_status");
        if (res) {
          const wasRunning = rlStatus === "RL Running";
          const isRunning = res.is_running;
          setRlStatus(isRunning ? "RL Running" : "RL Closed");
          if (!wasRunning && isRunning && autoInject) inject();
        }
      } catch (e) {
        console.error(e);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthorized, isRevoked, rlStatus, autoInject]);

  async function authorize(keyToTry: string) {
    if (!keyToTry.trim()) { setStatus("Please enter a key"); return; }
    setStatus("validating key...");
    setIsRevoked(false);
    try {
      const hwid = await tryInvoke<string>("get_hwid") || "UNKNOWN-HWID";
      const res = await tryInvoke<KeyValidationResponse>("validate_key", { key: keyToTry.trim(), hwid });

      if (res?.status === "valid") {
        localStorage.setItem(LS_KEYS.apiKey, keyToTry.trim());
        setUserData(res.user);
        setIsAuthorized(true);
        setIsRevoked(false);
        setStatus("ready");
      } else if (res?.status === "revoked") {
        setIsRevoked(true);
        setIsAuthorized(false);
        setStatus("Error: Key Revoked");
      } else if (res?.status === "invalid_hwid") {
        setStatus("Error: Key locked to another PC");
        setIsAuthorized(false);
      } else {
        setStatus("Error: Invalid key");
        setIsAuthorized(false);
      }
    } catch {
      setStatus("Network Error: Check connection");
    }
  }

  async function saveConfig() {
    localStorage.setItem(LS_KEYS.spoofed, spoofedUsername.trim());
    localStorage.setItem(LS_KEYS.platform, platform);
    try {
      await tryInvoke("save_config", { name: spoofedUsername.trim(), platform });
      setStatus("saved successfully");
      window.setTimeout(() => setStatus("ready"), 1400);
    } catch (e) {
      setStatus("Save error: " + String(e));
    }
  }

  async function inject() {
    setStatus("injecting...");
    try {
      const res = await tryInvoke<string>("inject_dll", { discordId: userData?.discordId });
      setLastLog(res || "Successfully Injected!");
      setStatus("Successfully Injected!");
      window.setTimeout(() => setStatus("ready"), 1400);
    } catch (e) {
      setStatus("Injection Failed!");
      setLastLog(String(e));
      setLogsOpen(true);
    }
  }

  function toggleMinimizeToTray(next: boolean) {
    setMinimizeToTray(next);
    localStorage.setItem(LS_KEYS.minimizeToTray, String(next));
  }

  function toggleAutoInject(next: boolean) {
    setAutoInject(next);
    localStorage.setItem(LS_KEYS.autoInject, String(next));
  }

  async function handleMinimizeClick() {
    if (!isTauriRuntime()) return;
    if (minimizeToTray) {
      await tryInvoke("minimize_to_tray");
    } else {
      await tryWindowApi(w => w.minimize());
    }
  }

  const logout = () => {
    localStorage.removeItem(LS_KEYS.apiKey);
    window.location.reload();
  };

  const closeAllModals = () => {
    setSettingsOpen(false);
    setLogsOpen(false);
    setDebugOpen(false);
  };

  const isModalOpen = settingsOpen || logsOpen || debugOpen;

  // ── Auth screen ───────────────────────────────────────────────────────────
  if (!isAuthorized) {
    return (
      <div className="app-shell">
        <div className={`bg-aurora ${isRevoked ? "revoked-aurora" : ""}`} aria-hidden="true" />

        <div className="window-titlebar" data-tauri-drag-region>
          <div className="window-titlebar-left">
            <img
              src="/rlidentity.webp"
              className="app-logo"
              alt="logo"
              onClick={handleLogoClick}
              draggable="false"
              style={{ cursor: "default" }}
            />
            <div className="titlebar-text" data-tauri-drag-region>
              <div className="app-name neon-text-soft">
                RLidentity <span style={{ fontSize: "10px", opacity: 0.6, marginLeft: "4px" }}>v2.0.0</span>
              </div>
              <div className="app-slogan">{isRevoked ? "License Revoked" : "Authorize to continue"}</div>
            </div>
          </div>
          <div className="titlebar-controls">
            <button className="win-btn" onClick={handleMinimizeClick}>—</button>
            <button className="win-btn" onClick={() => tryWindowApi(w => w.close())}>✕</button>
          </div>
        </div>

        <main className="panel-wrap">
          <section className={`glass-card neon-ring ${isRevoked ? "revoked" : ""}`} style={{ maxWidth: "400px", margin: "auto" }}>
            <header className="card-header">
              <h1 className={`headline neon-text ${isRevoked ? "red" : ""}`}>
                {isRevoked ? "ACCESS REVOKED" : "RLidentity"}
              </h1>
              <p className="app-slogan">
                {isRevoked ? "This license is no longer active" : "Enter your API key to continue"}
              </p>
            </header>
            <div className="form-stack">
              {!isRevoked && (
                <div className="field">
                  <label className="label">License Key</label>
                  <div className="glass-input">
                    <input
                      type="password"
                      className="input"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && authorize(apiKey)}
                      placeholder="Enter your license key..."
                    />
                  </div>
                </div>
              )}
              <button className="btn btn-primary" onClick={() => isRevoked ? logout() : authorize(apiKey)}>
                {isRevoked ? "Change Key" : "Login"}
              </button>
              {status !== "ready" && (
                <p className="status-value" style={{
                  textAlign: "center",
                  marginTop: "10px",
                  color: (isRevoked || status.startsWith("Error")) ? "var(--red0)" : "inherit",
                }}>
                  {status}
                </p>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <div className="bg-aurora" aria-hidden="true" />

      <div className="window-titlebar" data-tauri-drag-region>
        <div className="window-titlebar-left">
          <img
            src="/rlidentity.webp"
            className="app-logo"
            alt="logo"
            onClick={handleLogoClick}
            draggable="false"
            style={{ cursor: "default" }}
          />
          <div className="titlebar-app-name neon-text-soft" data-tauri-drag-region>RLidentity</div>
        </div>
        <div className="titlebar-controls-wrap" data-tauri-drag-region>
          <div className="titlebar-controls">
            <button className="tb-action" onClick={() => setSettingsOpen(true)}>Settings</button>
            <button className="tb-action" onClick={() => openUrl(GITHUB_URL)}>GitHub</button>
            <button className="win-btn" onClick={handleMinimizeClick}>—</button>
            <button className="win-btn" onClick={() => tryWindowApi(w => w.close())}>✕</button>
          </div>
        </div>
      </div>

      <main className="panel-wrap">
        <header className="welcome-section">
          <h2 className="welcome-text">
            Welcome, <span className="neon-text-soft">{userData?.globalName || userData?.username || "User"}</span>
          </h2>
          <div className="user-id-badge">User #{userData?.userId || "0"}</div>
        </header>

        <section className="glass-card neon-ring">
          <header className="card-header">
            <h1 className="headline neon-text">Be anyone, Win everything</h1>
          </header>

          <div className="form-stack">
            <div className="field">
              <label className="label">spoofed username</label>
              <div className="glass-input">
                <input
                  className="input"
                  value={spoofedUsername}
                  onChange={e => setSpoofedUsername(e.target.value)}
                  placeholder="Enter a username..."
                />
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={inject}
              disabled={rlStatus !== "RL Running"}
            >
              {rlStatus === "RL Running" ? "Inject" : "Start Rocket League"}
            </button>

            <div className="btn-row">
              <button className="btn btn-secondary" onClick={() => openUrl(FAQ_URL)}>FAQ</button>
              <button className="btn btn-tertiary" onClick={saveConfig}>Save Name</button>
            </div>
          </div>

          <footer className="status-bar">
            <div className="status-item">
              <span className="status-label">status</span>
              <span className="status-value">{status}</span>
            </div>
            <div className="status-item">
              <span className="status-label">game</span>
              <span className={`status-value ${rlStatus === "RL Running" ? "status-active" : ""}`}>{rlStatus}</span>
            </div>
          </footer>
        </section>
      </main>

      {/* ── Modals ── */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeAllModals}>
          <div
            className="modal glass-card neon-ring"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: logsOpen || debugOpen ? "600px" : "420px" }}
          >
            {debugOpen ? (
              <>
                <h2 className="modal-title neon-text-soft">System Credits</h2>
                <div className="credits-grid glass-input">
                  {[
                    { role: "Lead Dev & Owner", name: "Bits",        accent: true },
                    { role: "Dev & Admin",      name: "Danni" },
                    { role: "Co-Owner",         name: "Deniz" },
                    { role: "Administrator",    name: "Kairo" },
                    { role: "Helpers",          name: "Quinn, SNDR" },
                    { role: "Tester",           name: "Emir" },
                  ].map(({ role, name, accent }) => (
                    <div key={role} className="credit-row">
                      <span className="credit-role">{role}</span>
                      <span className={accent ? "neon-text-soft" : "credit-name"}>{name}</span>
                    </div>
                  ))}
                  <hr className="credit-divider" />
                  <button className="btn btn-secondary" style={{ width: "100%" }} onClick={() => openUrl("https://rlidentity.me/discord")}>
                    Join Discord — rlidentity.me/discord
                  </button>
                </div>
                <button className="btn btn-primary" style={{ marginTop: "14px" }} onClick={() => setDebugOpen(false)}>Close</button>
              </>
            ) : logsOpen ? (
              <>
                <h2 className="modal-title neon-text-soft">Injection Logs</h2>
                <div className="glass-input" style={{ height: "300px", padding: "10px", overflowY: "auto" }}>
                  <pre style={{ fontSize: "12px", color: "#fff", whiteSpace: "pre-wrap", margin: 0 }}>
                    {lastLog || "No logs yet..."}
                  </pre>
                </div>
                <button className="btn btn-primary" style={{ marginTop: "14px" }} onClick={() => setLogsOpen(false)}>Close Logs</button>
              </>
            ) : (
              <>
                <h2 className="modal-title neon-text-soft">Settings</h2>

                {/* Platform */}
                <div className="setting-row">
                  <div className="setting-text">
                    <div className="setting-title">Platform</div>
                  </div>
                  <div className="custom-dropdown-wrap">
                    <button
                      className="dropdown-trigger"
                      onClick={() => setPlatformPickerOpen(p => !p)}
                    >
                      <span>{platform === "Epic" ? "Epic Games" : "Steam"}</span>
                      <span className="dropdown-arrow">▾</span>
                    </button>
                    {platformPickerOpen && (
                      <div className="dropdown-menu">
                        {["Epic", "Steam"].map(p => (
                          <button
                            key={p}
                            className={`dropdown-item ${platform === p ? "active" : ""}`}
                            onClick={() => { setPlatform(p); setPlatformPickerOpen(false); }}
                          >
                            {p === "Epic" ? "Epic Games" : "Steam"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Theme picker */}
                <div className="setting-row">
                  <div className="setting-text">
                    <div className="setting-title">Theme</div>
                    <div className="setting-sub">Accent color</div>
                  </div>
                  <div className="theme-swatches">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        className={`theme-swatch ${theme === t.id ? "active" : ""}`}
                        style={{ "--swatch-color": t.color } as React.CSSProperties}
                        onClick={() => setTheme(t.id)}
                        title={t.label}
                        aria-label={`${t.label} theme`}
                      />
                    ))}
                  </div>
                </div>

                {/* Auto inject */}
                <div className="setting-row">
                  <div className="setting-text">
                    <div className="setting-title">Auto Injection</div>
                    <div className="setting-sub">Injects automatically when RL starts</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={autoInject} onChange={e => toggleAutoInject(e.target.checked)} />
                    <span className="switch-ui" />
                  </label>
                </div>

                {/* Minimize to tray */}
                <div className="setting-row">
                  <div className="setting-text">
                    <div className="setting-title">Minimize to tray</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={minimizeToTray} onChange={e => toggleMinimizeToTray(e.target.checked)} />
                    <span className="switch-ui" />
                  </label>
                </div>

                <div className="btn-stack">
                  <button className="btn btn-tertiary" onClick={() => { setSettingsOpen(false); setLogsOpen(true); }}>
                    View Last Injection Log
                  </button>
                  <button className="btn btn-secondary" onClick={logout}>Logout</button>
                  <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Update modal ── */}
      {pendingUpdate && (
        <div className="modal-overlay" onClick={() => setPendingUpdate(null)}>
          <div className="modal glass-card neon-ring" onClick={e => e.stopPropagation()} style={{ maxWidth: "380px" }}>
            <h2 className="modal-title neon-text-soft">Update Available</h2>
            <p style={{ margin: "0 0 20px", color: "var(--muted)", fontSize: "14px" }}>
              Version <strong style={{ color: "var(--text)" }}>{pendingUpdate.version}</strong> is ready to install.
              The app will restart automatically.
            </p>
            <div className="btn-row">
              <button className="btn btn-secondary" onClick={() => setPendingUpdate(null)}>Later</button>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={pendingUpdate.install}>
                Update Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}