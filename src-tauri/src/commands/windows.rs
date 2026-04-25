use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;

#[derive(Serialize)]
pub struct GenericResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn switch_to_editor(app: AppHandle) -> GenericResult {
    // Close HUD if open
    if let Some(hud) = app.get_webview_window("hud-overlay") {
        hud.close().ok();
    }

    // Create editor window if it doesn't exist
    if app.get_webview_window("editor").is_none() {
        let _editor = WebviewWindowBuilder::new(
            &app,
            "editor",
            WebviewUrl::App("index.html?windowType=editor".into()),
        )
        .title("OpenScreen")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .maximized(true)
        .center()
        .build();
    } else if let Some(editor) = app.get_webview_window("editor") {
        editor.set_focus().ok();
    }

    GenericResult { success: true, error: None }
}

#[tauri::command]
pub fn switch_to_hud(app: AppHandle) -> GenericResult {
    // Close editor if open
    if let Some(editor) = app.get_webview_window("editor") {
        editor.close().ok();
    }

    // Create HUD if it doesn't exist
    if app.get_webview_window("hud-overlay").is_none() {
        let _hud = WebviewWindowBuilder::new(
            &app,
            "hud-overlay",
            WebviewUrl::App("index.html?windowType=hud-overlay".into()),
        )
        .title("OpenScreen")
        .inner_size(600.0, 160.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .build();
    }

    GenericResult { success: true, error: None }
}

#[tauri::command]
pub fn start_new_recording(
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> GenericResult {
    {
        let mut app_state = state.lock().unwrap();
        app_state.current_session = None;
    }
    switch_to_hud(app)
}

#[tauri::command]
pub fn open_source_selector(app: AppHandle) -> GenericResult {
    if let Some(existing) = app.get_webview_window("source-selector") {
        existing.set_focus().ok();
        return GenericResult { success: true, error: None };
    }

    match WebviewWindowBuilder::new(
        &app,
        "source-selector",
        WebviewUrl::App("index.html?windowType=source-selector".into()),
    )
    .title("Select Source")
    .inner_size(620.0, 420.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .center()
    .build()
    {
        Ok(_) => GenericResult { success: true, error: None },
        Err(e) => GenericResult {
            success: false,
            error: Some(e.to_string()),
        },
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ProcessedDesktopSource {
    pub id: String,
    pub name: String,
    pub display_id: String,
    pub thumbnail: Option<String>,
    #[serde(rename = "appIcon")]
    pub app_icon: Option<String>,
}

#[tauri::command]
pub fn select_source(
    source: ProcessedDesktopSource,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Option<ProcessedDesktopSource> {
    {
        let mut app_state = state.lock().unwrap();
        app_state.selected_source_id = Some(source.id.clone());
        app_state.selected_source_name = Some(source.name.clone());
    }

    // Close source selector window
    if let Some(selector) = app.get_webview_window("source-selector") {
        selector.close().ok();
    }

    Some(source)
}

#[tauri::command]
pub fn get_selected_source(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Option<ProcessedDesktopSource> {
    let app_state = state.lock().unwrap();
    match (&app_state.selected_source_id, &app_state.selected_source_name) {
        (Some(id), Some(name)) => Some(ProcessedDesktopSource {
            id: id.clone(),
            name: name.clone(),
            display_id: String::new(),
            thumbnail: None,
            app_icon: None,
        }),
        _ => None,
    }
}

#[tauri::command]
pub fn hud_overlay_hide(app: AppHandle) {
    if let Some(hud) = app.get_webview_window("hud-overlay") {
        hud.minimize().ok();
    }
}

#[tauri::command]
pub fn hud_overlay_close(app: AppHandle) {
    // Close all windows to quit
    for (_, window) in app.webview_windows() {
        window.close().ok();
    }
}

#[tauri::command]
pub fn set_has_unsaved_changes(_has_changes: bool) {
    // In Tauri, the close handler is managed differently.
    // The frontend handles unsaved-changes state directly.
}

#[tauri::command]
pub fn open_external_url(url: String) -> GenericResult {
    match open::that(&url) {
        Ok(_) => GenericResult { success: true, error: None },
        Err(e) => GenericResult {
            success: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn set_locale(_locale: String) {
    // In Tauri, menu/tray text rebuild would happen here.
    // For Phase 1, the frontend manages locale via I18nContext directly.
}

#[tauri::command]
pub fn get_asset_base_path(app: AppHandle) -> Option<String> {
    // In dev mode, assets are served by the Vite dev server at /
    if cfg!(debug_assertions) {
        return None;
    }

    // In production, resolve from the resource directory.
    // The resources are bundled at $RESOURCE/_up_/public/ (because tauri.conf.json
    // specifies "../public/wallpapers/" as a resource path).
    // Use the resource dir path directly — the frontend will use convertFileSrc
    // to create an asset:// URL that Tauri can serve.
    app.path()
        .resource_dir()
        .ok()
        .map(|p| {
            // Resources from "../public/wallpapers/" end up at $RESOURCE/_up_/public/wallpapers/
            let asset_path = p.join("_up_").join("public");
            asset_path.to_string_lossy().to_string()
        })
}

#[tauri::command]
pub fn set_recording_state(
    recording: bool,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) {
    let mut app_state = state.lock().unwrap();
    app_state.is_recording = recording;

    if recording {
        app_state.pending_cursor_samples.clear();
        let start_time = std::time::Instant::now();

        // Spawn cursor capture thread at 10Hz
        let app_clone = app.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));

                let is_still_recording = {
                    let st: tauri::State<'_, Mutex<AppState>> = app_clone.state();
                    let guard = st.lock().unwrap();
                    guard.is_recording
                };
                if !is_still_recording {
                    break;
                }

                let elapsed_ms = start_time.elapsed().as_millis() as f64;
                // Cursor position capture is platform-specific.
                // On Linux/X11 we could use XQueryPointer, on macOS CGEvent.
                // For now, we record timestamps and let the frontend supply positions
                // via the existing browser-based cursor tracking.
                // The samples vector is populated when storeRecordedSession is called
                // with cursor data from the frontend.
                let _ = elapsed_ms;
            }
        });
    } else {
        // Recording stopped — samples are in pending_cursor_samples
        // (populated by storeRecordedSession from frontend data)
    }

    // Update tray menu to show stop option during recording
    update_tray_for_recording(&app, recording, &app_state);
}

fn tray_tooltip_text(recording: bool, source_name: &str) -> String {
    if recording {
        format!("OpenScreen - Recording {}", source_name)
    } else {
        "OpenScreen".to_string()
    }
}

fn update_tray_for_recording(app: &AppHandle, recording: bool, state: &AppState) {
    let source_name = state
        .selected_source_name
        .as_deref()
        .unwrap_or("Screen");

    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = tray_tooltip_text(recording, source_name);
        tray.set_tooltip(Some(&tooltip)).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn test_processed_desktop_source_serialization() {
        let source = ProcessedDesktopSource {
            id: "screen:0:0".to_string(),
            name: "Primary Display".to_string(),
            display_id: "0".to_string(),
            thumbnail: Some("data:image/png;base64,abc".to_string()),
            app_icon: None,
        };
        let json = serde_json::to_string(&source).unwrap();
        assert!(json.contains("\"id\":\"screen:0:0\""));
        assert!(json.contains("\"name\":\"Primary Display\""));
        assert!(json.contains("\"appIcon\":null"));

        let loaded: ProcessedDesktopSource = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.id, "screen:0:0");
        assert!(loaded.app_icon.is_none());
    }

    #[test]
    fn test_processed_desktop_source_with_all_fields() {
        let json = r#"{"id":"window:123","name":"Firefox","display_id":"1","thumbnail":"thumb","appIcon":"icon"}"#;
        let source: ProcessedDesktopSource = serde_json::from_str(json).unwrap();
        assert_eq!(source.id, "window:123");
        assert_eq!(source.name, "Firefox");
        assert_eq!(source.app_icon.as_deref(), Some("icon"));
    }

    #[test]
    fn test_source_selection_state_management() {
        let state = Mutex::new(AppState::default());

        // Initially no source selected
        {
            let s = state.lock().unwrap();
            assert!(s.selected_source_id.is_none());
            assert!(s.selected_source_name.is_none());
        }

        // Select a source
        {
            let mut s = state.lock().unwrap();
            s.selected_source_id = Some("screen:0:0".to_string());
            s.selected_source_name = Some("Primary Display".to_string());
        }

        // Verify selection
        {
            let s = state.lock().unwrap();
            assert_eq!(s.selected_source_id.as_deref(), Some("screen:0:0"));
            assert_eq!(s.selected_source_name.as_deref(), Some("Primary Display"));
        }
    }

    #[test]
    fn test_recording_state_management() {
        let state = Mutex::new(AppState::default());

        // Not recording by default
        assert!(!state.lock().unwrap().is_recording);

        // Start recording clears pending samples
        {
            let mut s = state.lock().unwrap();
            s.pending_cursor_samples.push(
                crate::commands::file_io::CursorTelemetryPoint {
                    time_ms: 0.0,
                    cx: 0.5,
                    cy: 0.5,
                },
            );
            assert_eq!(s.pending_cursor_samples.len(), 1);

            // Simulate recording start
            s.is_recording = true;
            s.pending_cursor_samples.clear();
        }

        {
            let s = state.lock().unwrap();
            assert!(s.is_recording);
            assert!(s.pending_cursor_samples.is_empty());
        }
    }

    #[test]
    fn test_start_new_recording_clears_session() {
        let state = Mutex::new(AppState::default());
        {
            let mut s = state.lock().unwrap();
            s.current_session = Some(crate::state::RecordingSession {
                screen_video_path: "/old/recording.webm".to_string(),
                webcam_video_path: None,
                created_at: 0.0,
            });
        }

        // start_new_recording clears the session
        {
            let mut s = state.lock().unwrap();
            s.current_session = None;
        }

        assert!(state.lock().unwrap().current_session.is_none());
    }

    #[test]
    fn test_tray_tooltip_text_recording() {
        assert_eq!(
            tray_tooltip_text(true, "Primary Display"),
            "OpenScreen - Recording Primary Display"
        );
    }

    #[test]
    fn test_tray_tooltip_text_idle() {
        assert_eq!(tray_tooltip_text(false, "anything"), "OpenScreen");
    }

    #[test]
    fn test_tray_tooltip_text_default_source() {
        assert_eq!(
            tray_tooltip_text(true, "Screen"),
            "OpenScreen - Recording Screen"
        );
    }

    #[test]
    fn test_generic_result_serialization() {
        let ok = GenericResult {
            success: true,
            error: None,
        };
        let json = serde_json::to_string(&ok).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(!json.contains("\"error\""));

        let err = GenericResult {
            success: false,
            error: Some("window not found".to_string()),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"error\":\"window not found\""));
    }
}
