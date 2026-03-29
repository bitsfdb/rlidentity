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

const LS_KEYS = {
  spoofed: "rlidentity.spoofedUsername",
  apiKey: "rlidentity.apiKey",
  minimizeToTray: "rlidentity.minimizeToTray",
  platform: "rlidentity.platform",
  autoInject: "rlidentity.autoInject",
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
  const initialApiKey = useMemo(() => localStorage.getItem(LS_KEYS.apiKey) ?? "", []);
  const initialSpoofed = useMemo(() => localStorage.getItem(LS_KEYS.spoofed) ?? "", []);
  const initialMinToTray = useMemo(() => localStorage.getItem(LS_KEYS.minimizeToTray) === "true", []);
  const initialPlatform = useMemo(() => localStorage.getItem(LS_KEYS.platform) ?? "Epic", []);
  const initialAutoInject = useMemo(() => localStorage.getItem(LS_KEYS.autoInject) === "true", []);

  const [apiKey, setApiKey] = useState(initialApiKey);
  const [spoofedUsername, setSpoofedUsername] = useState(initialSpoofed);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isRevoked, setIsRevoked] = useState(false);
  const [userData, setUserData] = useState<UserInfo | null>(null);
  
  const [status, setStatus] = useState<Status>("ready");
  const [rlStatus, setRlStatus] = useState("Checking...");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [lastLog, setLastLog] = useState("");
  const [minimizeToTray, setMinimizeToTray] = useState(initialMinToTray);
  const [platform, setPlatform] = useState(initialPlatform);
  const [autoInject, setAutoInject] = useState(initialAutoInject);
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  
  // Easter Egg State
  const [debugOpen, setDebugOpen] = useState(false);
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

  // Tutorial State
  const [tutorialStep, setTutorialStep] = useState(-1);

  // Startup Authorization & Update Check
  useEffect(() => {
    if (initialApiKey) {
      authorize(initialApiKey);
    }
    syncAssetsAndCheckUpdates();
  }, []);

  async function syncAssetsAndCheckUpdates() {
    if (!isTauriRuntime()) return;
    
    // 1. Download DLL and Injector
    try {
      await tryInvoke("download_assets");
      console.log("Assets synced successfully");
    } catch (e) {
      console.error("Failed to sync assets:", e);
    }

    // 2. Check for App updates
    checkForUpdates();
  }

  async function checkForUpdates() {
    if (!isTauriRuntime()) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        console.log(`Update available: ${update.version}`);
        const confirmed = window.confirm(`A new version (${update.version}) is available. Would you like to update?`);
        if (confirmed) {
          setStatus("Updating...");
          await update.downloadAndInstall();
          // The app will restart automatically after install on some platforms, 
          // or we might need to relaunch. Tauri v2 updater usually handles this.
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      }
    } catch (e) {
      console.error("Failed to check for updates:", e);
    }
  }

  // Sync revoked background to body
  useEffect(() => {
    if (isRevoked) {
        document.body.classList.add('revoked-bg');
    } else {
        document.body.classList.remove('revoked-bg');
    }
  }, [isRevoked]);

  // Poll for Rocket League status & Auto Inject
  useEffect(() => {
    if (!isAuthorized || isRevoked) return;
    const interval = setInterval(async () => {
        try {
            const res = await tryInvoke<{is_running: boolean}>("check_status");
            if (res) {
                const wasRunning = rlStatus === "RL Running";
                const isRunning = res.is_running;
                setRlStatus(isRunning ? "RL Running" : "RL Closed");
                
                // Auto Inject Logic: if it just started running and autoInject is on
                if (!wasRunning && isRunning && autoInject) {
                  inject();
                }
            }
        } catch (e) {
            console.error(e);
        }
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthorized, isRevoked, rlStatus, autoInject]);

  async function authorize(keyToTry: string) {
    if (!keyToTry.trim()) {
        setStatus("Please enter a key");
        return;
    }
    setStatus("validating key...");
    setIsRevoked(false);
    try {
        const hwid = await tryInvoke<string>("get_hwid") || "UNKNOWN";
        const res = await tryInvoke<KeyValidationResponse>("validate_key", { key: keyToTry.trim(), hwid });
        
        if (res && res.status === "valid") {
            localStorage.setItem(LS_KEYS.apiKey, keyToTry.trim());
            setUserData(res.user);
            setIsAuthorized(true);
            setIsRevoked(false);
            setStatus("ready");
            
            // Check for tutorial
            if (res.user?.logins === 0) {
              setTutorialStep(0);
            }
        } else if (res && res.status === "revoked") {
            setIsRevoked(true);
            setIsAuthorized(false);
            setStatus("Error: Key Revoked");
        } else if (res && res.status === "invalid_hwid") {
            setStatus("Error: Key locked to another PC");
            setIsAuthorized(false);
        } else {
            setStatus("Error: Invalid key");
            setIsAuthorized(false);
        }
    } catch (e) {
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
      await tryWindowApi((w) => w.minimize());
    }
  }

  const logout = () => {
    localStorage.removeItem(LS_KEYS.apiKey);
    window.location.reload();
  };

  const tutorialSteps = [
    { title: "Welcome to RLidentity", text: "Let's show you around. First, enter your spoofed username here.", target: "input" },
    { title: "Injection", text: "Once Rocket League is running, click Inject to start. Or enable Auto-Inject in settings!", target: "btn-primary" },
    { title: "Settings", text: "Customize your experience here. Change your platform or toggle Auto-Injection.", target: "tb-action" },
    { title: "All Set!", text: "You're ready to win. Happy gaming!", target: "none" }
  ];

  if (!isAuthorized) {
    return (
      <div className="app-shell">
        <div className={`bg-aurora ${isRevoked ? 'revoked-aurora' : ''}`} aria-hidden="true" />
        
        <div className="window-titlebar" data-tauri-drag-region>
          <div className="window-titlebar-left">
            <img src="/rlidentity.webp" className="app-logo" alt="logo" onClick={handleLogoClick} draggable="false" style={{ cursor: 'default' }} />
            <div className="titlebar-text" data-tauri-drag-region>
              <div className="app-name neon-text-soft">RLidentity <span style={{ fontSize: '10px', opacity: 0.6, marginLeft: '4px' }}>v2.0.0</span></div>
              <div className="app-slogan">{isRevoked ? 'License Revoked' : 'Authorize to continue'}</div>
            </div>
          </div>

          <div className="titlebar-controls">
            <button className="win-btn" onClick={handleMinimizeClick}>—</button>
            <button className="win-btn" onClick={async () => await tryWindowApi(w => w.close())}>✕</button>
          </div>
        </div>

        <main className="panel-wrap">
          <section className={`glass-card neon-ring ${isRevoked ? 'revoked' : ''}`} style={{ maxWidth: '400px', margin: 'auto' }}>
            <header className="card-header">
              <h1 className={`headline neon-text ${isRevoked ? 'red' : ''}`}>
                {isRevoked ? 'ACCESS REVOKED' : 'RLidentity'}
              </h1>
              <p className="app-slogan">
                {isRevoked ? 'This license is no longer active' : 'Enter your API key to continue'}
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
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter your license key..."
                    />
                  </div>
                </div>
              )}
              
              <button className="btn btn-primary" onClick={() => isRevoked ? logout() : authorize(apiKey)}>
                {isRevoked ? 'Change Key' : 'Login'}
              </button>

              {status !== "ready" && (
                  <p className="status-value" style={{textAlign:'center', marginTop:'10px', color: (isRevoked || status.startsWith('Error')) ? '#ff5555' : 'inherit'}}>
                      {status}
                  </p>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
      <div className="app-shell">
        <div className="bg-aurora" aria-hidden="true" />

        <div className="window-titlebar" data-tauri-drag-region>
          <div className="window-titlebar-left">
            <img src="/rlidentity.webp" className="app-logo" alt="logo" onClick={handleLogoClick} draggable="false" style={{ cursor: 'default' }} />
            <div className="titlebar-app-name neon-text-soft" data-tauri-drag-region>RLidentity</div>
          </div>

          <div className="titlebar-controls-wrap" data-tauri-drag-region>
            <div className="titlebar-controls">
              <button id="step-settings" className="tb-action" onClick={() => setSettingsOpen(true)}>Settings</button>
              <button className="tb-action" onClick={() => openUrl(GITHUB_URL)}>GitHub</button>
              <button className="win-btn" onClick={handleMinimizeClick}>—</button>
              <button className="win-btn" onClick={async () => await tryWindowApi(w => w.close())}>✕</button>
            </div>
          </div>
        </div>

        <main className="panel-wrap">
          <header className="welcome-section">
            <h2 className="welcome-text">Welcome, <span className="neon-text-soft">{userData?.globalName || userData?.username || "User"}</span></h2>
            <div className="user-id-badge">User #{userData?.userId || "0"}</div>
          </header>

          <section className="glass-card neon-ring">
            <header className="card-header">
              <h1 className="headline neon-text">Be anyone, Win everything</h1>
            </header>

            <div className="form-stack">
              <div className="field" id="step-username">
                <label className="label">spoofed username</label>
                <div className="glass-input">
                  <input
                      className="input"
                      value={spoofedUsername}
                      onChange={(e) => setSpoofedUsername(e.target.value)}
                  />
                </div>
              </div>

              <button 
                id="step-inject"
                className="btn btn-primary" 
                onClick={inject}
                disabled={rlStatus !== "RL Running" && tutorialStep !== 1}
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
                <span className="status-value">{rlStatus}</span>
              </div>
            </footer>
          </section>
        </main>

        {(settingsOpen || logsOpen || debugOpen) && (
            <div className="modal-overlay" onClick={() => { setSettingsOpen(false); setLogsOpen(false); setDebugOpen(false); }}>
              <div className="modal glass-card neon-ring" onClick={e => e.stopPropagation()} style={{ maxWidth: (logsOpen || debugOpen) ? '600px' : '400px' }}>
                {debugOpen ? (
                    <>
                        <h2 className="modal-title neon-text-soft">System Credits & Debug</h2>
                        <div className="glass-input" style={{ padding: '15px', marginBottom: '15px' }}>
                            <div style={{ display: 'grid', gap: '10px', fontSize: '13px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#aaa' }}>Lead Dev & Owner:</span>
                                    <span className="neon-text-soft">Bits</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#aaa' }}>Dev & Admin:</span>
                                    <span style={{ color: '#fff' }}>Danni</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#aaa' }}>Co-Owner:</span>
                                    <span style={{ color: '#fff' }}>Deniz</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#aaa' }}>Administrator:</span>
                                    <span style={{ color: '#fff' }}>Kairo</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#aaa' }}>Helpers:</span>
                                    <span style={{ color: '#fff' }}>Quinn, SNDR</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#aaa' }}>Tester:</span>
                                    <span style={{ color: '#fff' }}>Emir</span>
                                </div>
                                <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '5px 0' }} />
                                <div style={{ textAlign: 'center' }}>
                                    <button 
                                        className="btn btn-secondary" 
                                        style={{ width: '100%', marginTop: '5px' }}
                                        onClick={() => openUrl('https://rlidentity.me/discord')}
                                    >
                                        Join Discord (rlidentity.me/discord)
                                    </button>
                                </div>
                            </div>
                        </div>
                        <button className="btn btn-primary" onClick={() => setDebugOpen(false)}>Close Debug</button>
                    </>
                ) : logsOpen ? (
                    <>
                        <h2 className="modal-title neon-text-soft">Injection Logs</h2>
                        <div className="glass-input" style={{ height: '300px', padding: '10px', overflowY: 'auto' }}>
                            <pre style={{ fontSize: '12px', color: '#fff', whiteSpace: 'pre-wrap' }}>
                                {lastLog || "No logs yet..."}
                            </pre>
                        </div>
                        <button className="btn btn-primary" onClick={() => setLogsOpen(false)}>Close Logs</button>
                    </>
                ) : (
                    <>
                        <h2 className="modal-title neon-text-soft">Settings</h2>
                        
                        <div className="setting-row">
                          <div className="setting-text">
                            <div className="setting-title">Platform</div>
                          </div>
                          <div className="custom-dropdown-wrap">
                            <button 
                              className="glass-input dropdown-trigger" 
                              onClick={() => setPlatformPickerOpen(!platformPickerOpen)}
                            >
                              <span className="dropdown-value">{platform === "Epic" ? "Epic Games" : "Steam"}</span>
                              <span className="dropdown-arrow">▾</span>
                            </button>
                            
                            {platformPickerOpen && (
                              <div className="dropdown-menu glass-card neon-ring">
                                <button 
                                  className={`dropdown-item ${platform === "Epic" ? "active" : ""}`}
                                  onClick={() => { setPlatform("Epic"); setPlatformPickerOpen(false); }}
                                >
                                  Epic Games
                                </button>
                                <button 
                                  className={`dropdown-item ${platform === "Steam" ? "active" : ""}`}
                                  onClick={() => { setPlatform("Steam"); setPlatformPickerOpen(false); }}
                                >
                                  Steam
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="setting-row" id="step-autoinject">
                          <div className="setting-text">
                            <div className="setting-title">Auto Injection</div>
                            <div className="setting-sub">Injects automatically when RL starts</div>
                          </div>
                          <label className="switch">
                            <input type="checkbox" checked={autoInject} onChange={e => toggleAutoInject(e.target.checked)} />
                            <span className="switch-ui" />
                          </label>
                        </div>

                        <div className="setting-row">
                          <div className="setting-text">
                            <div className="setting-title">Minimize to tray</div>
                          </div>
                          <label className="switch">
                            <input type="checkbox" checked={minimizeToTray} onChange={e => toggleMinimizeToTray(e.target.checked)} />
                            <span className="switch-ui" />
                          </label>
                        </div>

                        <div className="btn-row" style={{ flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                            <button className="btn btn-tertiary" onClick={() => { setSettingsOpen(false); setLogsOpen(true); }}>View Last Injection Log</button>
                            <button className="btn btn-secondary" onClick={logout}>Logout</button>
                            <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>Close</button>
                        </div>
                    </>
                )}
              </div>
            </div>
        )}

        {tutorialStep >= 0 && (
          <div className="tutorial-overlay">
            <div className={`tutorial-spotlight step-${tutorialStep}`} />
            <div className={`tutorial-card glass-card neon-ring step-${tutorialStep}`}>
              <h2 className="modal-title neon-text">{tutorialSteps[tutorialStep].title}</h2>
              <p className="modal-p">{tutorialSteps[tutorialStep].text}</p>
              <div className="btn-row">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setTutorialStep(-1)}
                >
                  Skip
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={() => {
                    if (tutorialStep === 2) {
                        setSettingsOpen(true);
                    }
                    if (tutorialStep < tutorialSteps.length - 1) {
                      setTutorialStep(tutorialStep + 1);
                    } else {
                      setSettingsOpen(false);
                      setTutorialStep(-1);
                    }
                  }}
                >
                  {tutorialStep < tutorialSteps.length - 1 ? "Next" : "Finish"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
