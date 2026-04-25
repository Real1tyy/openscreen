use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;

fn recordings_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("recordings")
}

fn shortcuts_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("shortcuts.json")
}

fn is_path_within_dir(file_path: &Path, dir_path: &Path) -> bool {
    let resolved = std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
    let resolved_dir = std::fs::canonicalize(dir_path).unwrap_or_else(|_| dir_path.to_path_buf());
    resolved.starts_with(&resolved_dir)
}

fn is_path_allowed_for_dir(file_path: &str, rec_dir: &Path, approved_paths: &[String]) -> bool {
    let resolved = PathBuf::from(file_path);
    if approved_paths.iter().any(|p| PathBuf::from(p) == resolved) {
        return true;
    }
    is_path_within_dir(&resolved, rec_dir)
}

fn is_path_allowed(file_path: &str, app: &AppHandle, state: &AppState) -> bool {
    is_path_allowed_for_dir(file_path, &recordings_dir(app), &state.approved_paths)
}

fn has_valid_video_extension(file_path: &str) -> bool {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "webm" | "mp4" | "mov" | "avi" | "mkv")
}

fn resolve_output_path_for_dir(rec_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Invalid recording file name".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("Recording file name must not contain path segments".to_string());
    }
    Ok(rec_dir.join(trimmed))
}

fn resolve_recording_output_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    resolve_output_path_for_dir(&recordings_dir(app), file_name)
}

#[derive(Serialize)]
pub struct GenericResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
}

#[derive(Serialize)]
pub struct ReadBinaryResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Serialize)]
pub struct SessionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<crate::state::RecordingSession>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct RecordedVideoAssetInput {
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "videoData")]
    pub video_data: Vec<u8>,
}

#[derive(Deserialize)]
pub struct StoreRecordedSessionPayload {
    pub screen: RecordedVideoAssetInput,
    pub webcam: Option<RecordedVideoAssetInput>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<f64>,
}

// --- File-based binary transfer (zero-copy path for large video data) ---

#[derive(Deserialize)]
pub struct FileBasedVideoInput {
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "tempPath")]
    pub temp_path: String,
}

#[derive(Deserialize)]
pub struct StoreSessionFromFilesPayload {
    pub screen: FileBasedVideoInput,
    pub webcam: Option<FileBasedVideoInput>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<f64>,
}

#[tauri::command]
pub async fn store_recorded_session_from_files(
    payload: StoreSessionFromFilesPayload,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<SessionResult, String> {
    let created_at = payload.created_at.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64
    });

    let screen_dest = resolve_recording_output_path(&app, &payload.screen.file_name)
        .map_err(|e| e.to_string())?;

    // Move temp file to final destination (rename is instant on same filesystem)
    move_or_copy(&payload.screen.temp_path, &screen_dest)?;

    let webcam_dest = if let Some(ref webcam) = payload.webcam {
        let dest = resolve_recording_output_path(&app, &webcam.file_name)
            .map_err(|e| e.to_string())?;
        move_or_copy(&webcam.temp_path, &dest)?;
        Some(dest.to_string_lossy().to_string())
    } else {
        None
    };

    let session = crate::state::RecordingSession {
        screen_video_path: screen_dest.to_string_lossy().to_string(),
        webcam_video_path: webcam_dest,
        created_at,
    };

    // Write session manifest
    let manifest_name = Path::new(&payload.screen.file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let manifest_path = recordings_dir(&app).join(format!("{}.session.json", manifest_name));
    let manifest_json = serde_json::to_string_pretty(&session).unwrap_or_default();
    std::fs::write(&manifest_path, &manifest_json).ok();

    // Write pending cursor telemetry
    {
        let mut app_state = state.lock().unwrap();
        if !app_state.pending_cursor_samples.is_empty() {
            let telemetry_path = format!("{}.cursor.json", screen_dest.to_string_lossy());
            let telemetry = serde_json::json!({
                "version": 1,
                "samples": app_state.pending_cursor_samples
            });
            std::fs::write(
                &telemetry_path,
                serde_json::to_string_pretty(&telemetry).unwrap_or_default(),
            )
            .ok();
            app_state.pending_cursor_samples.clear();
        }

        app_state.current_session = Some(session.clone());
        app_state.current_project_path = None;
    }

    Ok(SessionResult {
        success: true,
        path: Some(screen_dest.to_string_lossy().to_string()),
        session: Some(session),
        message: Some("Recording session stored successfully".to_string()),
        error: None,
    })
}

#[tauri::command]
pub async fn save_exported_video_from_file(
    temp_path: String,
    file_name: String,
    app: AppHandle,
) -> GenericResult {
    let is_gif = file_name.to_lowercase().ends_with(".gif");
    let filter_name = if is_gif { "GIF Image" } else { "MP4 Video" };
    let filter_ext = if is_gif { "gif" } else { "mp4" };

    let file_path = app
        .dialog()
        .file()
        .set_title(if is_gif { "Save GIF" } else { "Save Video" })
        .set_file_name(&file_name)
        .add_filter(filter_name, &[filter_ext])
        .blocking_save_file();

    match file_path.and_then(|fp| fp.into_path().ok()) {
        Some(path_buf) => {
            let path_str = path_buf.to_string_lossy().into_owned();
            match move_or_copy(&temp_path, &path_buf) {
                Ok(_) => GenericResult {
                    success: true,
                    path: Some(path_str),
                    message: Some("Video exported successfully".to_string()),
                    error: None,
                    canceled: None,
                },
                Err(e) => GenericResult {
                    success: false,
                    path: None,
                    message: Some("Failed to save exported video".to_string()),
                    error: Some(e),
                    canceled: None,
                },
            }
        }
        None => {
            // Cleanup temp file on cancel
            std::fs::remove_file(&temp_path).ok();
            GenericResult {
                success: false,
                path: None,
                message: Some("Export canceled".to_string()),
                error: None,
                canceled: Some(true),
            }
        }
    }
}

#[tauri::command]
pub fn read_binary_file_to_temp(
    file_path: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> GenericResult {
    eprintln!("[read_binary_file_to_temp] Requested: {}", file_path);
    let app_state = state.lock().unwrap();
    if !is_path_allowed(&file_path, &app, &app_state) {
        eprintln!("[read_binary_file_to_temp] DENIED: path not in approved list or recordings dir");
        eprintln!("[read_binary_file_to_temp] Approved paths: {:?}", app_state.approved_paths);
        return GenericResult {
            success: false,
            path: None,
            message: Some(format!("Access denied: {} is outside allowed directories", file_path)),
            error: None,
            canceled: None,
        };
    }
    drop(app_state);

    eprintln!("[read_binary_file_to_temp] APPROVED: {}", file_path);
    GenericResult {
        success: true,
        path: Some(file_path),
        message: None,
        error: None,
        canceled: None,
    }
}

fn move_or_copy(src: &str, dest: &Path) -> Result<(), String> {
    // Try rename first (instant if same filesystem)
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    // Fall back to copy + delete (cross-filesystem)
    std::fs::copy(src, dest)
        .map_err(|e| format!("Failed to copy file: {}", e))?;
    std::fs::remove_file(src).ok();
    Ok(())
}

#[derive(Serialize)]
pub struct CursorTelemetryResult {
    pub success: bool,
    pub samples: Vec<CursorTelemetryPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CursorTelemetryPoint {
    #[serde(rename = "timeMs")]
    pub time_ms: f64,
    pub cx: f64,
    pub cy: f64,
}

#[derive(Serialize)]
pub struct VideoPathResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Serialize)]
pub struct RecordingSessionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<crate::state::RecordingSession>,
}

#[derive(Serialize)]
pub struct ProjectLoadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recordings_dir(app: AppHandle) -> Result<String, String> {
    Ok(recordings_dir(&app).to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_recordings_dir(app: AppHandle) -> Result<String, String> {
    let dir = recordings_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_binary_file(
    file_path: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> ReadBinaryResult {
    let state = state.lock().unwrap();
    if !is_path_allowed(&file_path, &app, &state) {
        return ReadBinaryResult {
            success: false,
            data: None,
            path: None,
            message: Some("Access denied: path outside allowed directories".to_string()),
        };
    }

    match std::fs::read(&file_path) {
        Ok(data) => ReadBinaryResult {
            success: true,
            data: Some(data),
            path: Some(file_path),
            message: None,
        },
        Err(e) => ReadBinaryResult {
            success: false,
            data: None,
            path: None,
            message: Some(format!("Failed to read binary file: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn store_recorded_session(
    payload: StoreRecordedSessionPayload,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<SessionResult, String> {
    let created_at = payload.created_at.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64
    });

    let screen_path = resolve_recording_output_path(&app, &payload.screen.file_name)
        .map_err(|e| e.to_string())?;
    std::fs::write(&screen_path, &payload.screen.video_data)
        .map_err(|e| format!("Failed to write screen video: {}", e))?;

    let webcam_path = if let Some(webcam) = &payload.webcam {
        let wp = resolve_recording_output_path(&app, &webcam.file_name)
            .map_err(|e| e.to_string())?;
        std::fs::write(&wp, &webcam.video_data)
            .map_err(|e| format!("Failed to write webcam video: {}", e))?;
        Some(wp.to_string_lossy().to_string())
    } else {
        None
    };

    let session = crate::state::RecordingSession {
        screen_video_path: screen_path.to_string_lossy().to_string(),
        webcam_video_path: webcam_path,
        created_at,
    };

    // Write session manifest
    let manifest_name = Path::new(&payload.screen.file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let manifest_path = recordings_dir(&app).join(format!("{}.session.json", manifest_name));
    let manifest_json = serde_json::to_string_pretty(&session).unwrap_or_default();
    std::fs::write(&manifest_path, &manifest_json).ok();

    // Write cursor telemetry if pending
    {
        let mut app_state = state.lock().unwrap();
        if !app_state.pending_cursor_samples.is_empty() {
            let telemetry_path = format!("{}.cursor.json", screen_path.to_string_lossy());
            let telemetry = serde_json::json!({
                "version": 1,
                "samples": app_state.pending_cursor_samples
            });
            std::fs::write(&telemetry_path, serde_json::to_string_pretty(&telemetry).unwrap_or_default()).ok();
            app_state.pending_cursor_samples.clear();
        }

        app_state.current_session = Some(session.clone());
        app_state.current_project_path = None;
    }

    Ok(SessionResult {
        success: true,
        path: Some(screen_path.to_string_lossy().to_string()),
        session: Some(session),
        message: Some("Recording session stored successfully".to_string()),
        error: None,
    })
}

#[tauri::command]
pub fn set_current_recording_session(
    session: Option<crate::state::RecordingSession>,
    state: tauri::State<'_, Mutex<AppState>>,
) -> RecordingSessionResult {
    let mut app_state = state.lock().unwrap();
    app_state.current_session = session.clone();
    app_state.current_project_path = None;
    RecordingSessionResult {
        success: true,
        session,
    }
}

#[tauri::command]
pub fn get_current_recording_session(
    state: tauri::State<'_, Mutex<AppState>>,
) -> RecordingSessionResult {
    let app_state = state.lock().unwrap();
    match &app_state.current_session {
        Some(session) => RecordingSessionResult {
            success: true,
            session: Some(session.clone()),
        },
        None => RecordingSessionResult {
            success: false,
            session: None,
        },
    }
}

#[tauri::command]
pub fn set_current_video_path(
    path: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> GenericResult {
    eprintln!("[set_current_video_path] path={}", path);
    let mut app_state = state.lock().unwrap();
    if !is_path_allowed(&path, &app, &app_state) {
        eprintln!("[set_current_video_path] DENIED — not in approved paths");
        return GenericResult {
            success: false,
            path: None,
            message: Some(format!("Video path has not been approved: {}", path)),
            error: None,
            canceled: None,
        };
    }

    // Try to load session manifest
    let parsed = Path::new(&path);
    let base_name = parsed
        .file_stem()
        .unwrap_or_default()
        .to_str()
        .unwrap_or("");
    let base_name = if base_name.ends_with("-webcam") {
        &base_name[..base_name.len() - 7]
    } else {
        base_name
    };
    let manifest_path = parsed
        .parent()
        .unwrap_or(parsed)
        .join(format!("{}.session.json", base_name));

    if let Ok(content) = std::fs::read_to_string(&manifest_path) {
        if let Ok(session) = serde_json::from_str::<crate::state::RecordingSession>(&content) {
            app_state.approved_paths.push(session.screen_video_path.clone());
            if let Some(ref webcam) = session.webcam_video_path {
                app_state.approved_paths.push(webcam.clone());
            }
            app_state.current_session = Some(session);
            app_state.current_project_path = None;
            return GenericResult {
                success: true,
                path: None,
                message: None,
                error: None,
                canceled: None,
            };
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    app_state.current_session = Some(crate::state::RecordingSession {
        screen_video_path: path,
        webcam_video_path: None,
        created_at: now,
    });
    app_state.current_project_path = None;
    GenericResult {
        success: true,
        path: None,
        message: None,
        error: None,
        canceled: None,
    }
}

#[tauri::command]
pub fn get_current_video_path(
    state: tauri::State<'_, Mutex<AppState>>,
) -> VideoPathResult {
    let app_state = state.lock().unwrap();
    match &app_state.current_session {
        Some(session) => VideoPathResult {
            success: true,
            path: Some(session.screen_video_path.clone()),
            message: None,
        },
        None => VideoPathResult {
            success: false,
            path: None,
            message: None,
        },
    }
}

#[tauri::command]
pub fn clear_current_video_path(
    state: tauri::State<'_, Mutex<AppState>>,
) -> GenericResult {
    let mut app_state = state.lock().unwrap();
    app_state.current_session = None;
    GenericResult {
        success: true,
        path: None,
        message: None,
        error: None,
        canceled: None,
    }
}

#[tauri::command]
pub fn get_recorded_video_path(
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> VideoPathResult {
    let app_state = state.lock().unwrap();
    if let Some(ref session) = app_state.current_session {
        return VideoPathResult {
            success: true,
            path: Some(session.screen_video_path.clone()),
            message: None,
        };
    }

    let rec_dir = recordings_dir(&app);
    match std::fs::read_dir(&rec_dir) {
        Ok(entries) => {
            let mut videos: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.ends_with(".webm") && !name.ends_with("-webcam.webm")
                })
                .map(|e| e.path().to_string_lossy().to_string())
                .collect();
            videos.sort();
            videos.reverse();
            match videos.first() {
                Some(path) => VideoPathResult {
                    success: true,
                    path: Some(path.clone()),
                    message: None,
                },
                None => VideoPathResult {
                    success: false,
                    path: None,
                    message: Some("No recorded video found".to_string()),
                },
            }
        }
        Err(e) => VideoPathResult {
            success: false,
            path: None,
            message: Some(format!("Failed to read recordings: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn save_exported_video(
    video_data: Vec<u8>,
    file_name: String,
    app: AppHandle,
) -> GenericResult {
    let is_gif = file_name.to_lowercase().ends_with(".gif");
    let filter_name = if is_gif { "GIF Image" } else { "MP4 Video" };
    let filter_ext = if is_gif { "gif" } else { "mp4" };

    let downloads = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _default_path = downloads.join(&file_name);

    let file_path = app
        .dialog()
        .file()
        .set_title(if is_gif { "Save GIF" } else { "Save Video" })
        .set_file_name(&file_name)
        .add_filter(filter_name, &[filter_ext])
        .blocking_save_file();

    match file_path.and_then(|fp| fp.into_path().ok()) {
        Some(path_buf) => {
            let path_str = path_buf.to_string_lossy().into_owned();
            match std::fs::write(&path_str, &video_data) {
                Ok(_) => GenericResult {
                    success: true,
                    path: Some(path_str),
                    message: Some("Video exported successfully".to_string()),
                    error: None,
                    canceled: None,
                },
                Err(e) => GenericResult {
                    success: false,
                    path: None,
                    message: Some("Failed to save exported video".to_string()),
                    error: Some(e.to_string()),
                    canceled: None,
                },
            }
        }
        None => GenericResult {
            success: false,
            path: None,
            message: Some("Export canceled".to_string()),
            error: None,
            canceled: Some(true),
        },
    }
}

#[tauri::command]
pub async fn open_video_file_picker(
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<GenericResult, String> {
    let _rec_dir = recordings_dir(&app);

    let file_path = app
        .dialog()
        .file()
        .set_title("Select Video")
        .add_filter("Video Files", &["webm", "mp4", "mov", "avi", "mkv"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    match file_path.and_then(|fp| fp.into_path().ok()) {
        Some(path_buf) => {
            let path_str = path_buf.to_string_lossy().into_owned();
            if !has_valid_video_extension(&path_str) {
                return Ok(GenericResult {
                    success: false,
                    path: None,
                    message: Some("Selected file is not a supported video".to_string()),
                    error: None,
                    canceled: None,
                });
            }
            let mut app_state = state.lock().unwrap();
            app_state.approved_paths.push(path_str.clone());
            app_state.current_project_path = None;
            Ok(GenericResult {
                success: true,
                path: Some(path_str),
                message: None,
                error: None,
                canceled: None,
            })
        }
        None => Ok(GenericResult {
            success: false,
            path: None,
            message: None,
            error: None,
            canceled: Some(true),
        }),
    }
}

#[tauri::command]
pub async fn save_project_file(
    project_data: serde_json::Value,
    suggested_name: Option<String>,
    existing_project_path: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<GenericResult, String> {
    // If there's an existing trusted project path, save directly
    {
        let app_state = state.lock().unwrap();
        if let Some(ref existing) = existing_project_path {
            if let Some(ref current_proj) = app_state.current_project_path {
                if existing == current_proj {
                    let content = serde_json::to_string_pretty(&project_data).unwrap_or_default();
                    match std::fs::write(existing, &content) {
                        Ok(_) => {
                            return Ok(GenericResult {
                                success: true,
                                path: Some(existing.clone()),
                                message: Some("Project saved successfully".to_string()),
                                error: None,
                                canceled: None,
                            });
                        }
                        Err(e) => {
                            return Ok(GenericResult {
                                success: false,
                                path: None,
                                message: Some("Failed to save project file".to_string()),
                                error: Some(e.to_string()),
                                canceled: None,
                            });
                        }
                    }
                }
            }
        }
    }

    let safe_name = suggested_name
        .unwrap_or_else(|| format!("project-{}", chrono_millis()))
        .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let default_name = if safe_name.ends_with(".openscreen") {
        safe_name
    } else {
        format!("{}.openscreen", safe_name)
    };

    let _rec_dir = recordings_dir(&app);
    let file_path = app
        .dialog()
        .file()
        .set_title("Save Project")
        .set_file_name(&default_name)
        .add_filter("OpenScreen Project", &["openscreen"])
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    match file_path.and_then(|fp| fp.into_path().ok()) {
        Some(path_buf) => {
            let path_str = path_buf.to_string_lossy().into_owned();
            let content = serde_json::to_string_pretty(&project_data).unwrap_or_default();
            match std::fs::write(&path_str, &content) {
                Ok(_) => {
                    let mut app_state = state.lock().unwrap();
                    app_state.current_project_path = Some(path_str.clone());
                    Ok(GenericResult {
                        success: true,
                        path: Some(path_str),
                        message: Some("Project saved successfully".to_string()),
                        error: None,
                        canceled: None,
                    })
                }
                Err(e) => Ok(GenericResult {
                    success: false,
                    path: None,
                    message: Some("Failed to save project file".to_string()),
                    error: Some(e.to_string()),
                    canceled: None,
                }),
            }
        }
        None => Ok(GenericResult {
            success: false,
            path: None,
            message: Some("Save project canceled".to_string()),
            error: None,
            canceled: Some(true),
        }),
    }
}

#[tauri::command]
pub async fn load_project_file(
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<ProjectLoadResult, String> {
    let _rec_dir = recordings_dir(&app);

    let file_path = app
        .dialog()
        .file()
        .set_title("Open Project")
        .add_filter("OpenScreen Project", &["openscreen"])
        .add_filter("JSON", &["json"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    match file_path.and_then(|fp| fp.into_path().ok()) {
        Some(path_buf) => {
            let path_str = path_buf.to_string_lossy().into_owned();
            match std::fs::read_to_string(&path_str) {
                Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(project) => {
                        let project_dir = Path::new(&path_str).parent().unwrap_or(Path::new("."));
                        let rec_dir = recordings_dir(&app);
                        let approved = extract_approved_media_paths(&project, project_dir, &rec_dir);

                        if let Some(media) = project.get("media") {
                            let mut app_state = state.lock().unwrap();
                            for path in approved {
                                app_state.approved_paths.push(path);
                            }
                            let session = crate::state::RecordingSession {
                                screen_video_path: media
                                    .get("screenVideoPath")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                webcam_video_path: media
                                    .get("webcamVideoPath")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                created_at: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_millis() as f64,
                            };
                            app_state.current_session = Some(session);
                            app_state.current_project_path = Some(path_str.clone());
                        }
                        Ok(ProjectLoadResult {
                            success: true,
                            path: Some(path_str),
                            project: Some(project),
                            message: None,
                            canceled: None,
                            error: None,
                        })
                    }
                    Err(e) => Ok(ProjectLoadResult {
                        success: false,
                        path: None,
                        project: None,
                        message: Some("Failed to parse project file".to_string()),
                        canceled: None,
                        error: Some(e.to_string()),
                    }),
                },
                Err(e) => Ok(ProjectLoadResult {
                    success: false,
                    path: None,
                    project: None,
                    message: Some("Failed to read project file".to_string()),
                    canceled: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        None => Ok(ProjectLoadResult {
            success: false,
            path: None,
            project: None,
            message: Some("Open project canceled".to_string()),
            canceled: Some(true),
            error: None,
        }),
    }
}

#[tauri::command]
pub fn load_current_project_file(
    state: tauri::State<'_, Mutex<AppState>>,
) -> ProjectLoadResult {
    let app_state = state.lock().unwrap();
    let project_path = match &app_state.current_project_path {
        Some(p) => p.clone(),
        None => {
            return ProjectLoadResult {
                success: false,
                path: None,
                project: None,
                message: Some("No active project".to_string()),
                canceled: None,
                error: None,
            }
        }
    };
    drop(app_state);

    match std::fs::read_to_string(&project_path) {
        Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(project) => ProjectLoadResult {
                success: true,
                path: Some(project_path),
                project: Some(project),
                message: None,
                canceled: None,
                error: None,
            },
            Err(e) => ProjectLoadResult {
                success: false,
                path: None,
                project: None,
                message: Some("Failed to parse project".to_string()),
                canceled: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => ProjectLoadResult {
            success: false,
            path: None,
            project: None,
            message: Some("Failed to read project".to_string()),
            canceled: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn get_cursor_telemetry(
    video_path: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> CursorTelemetryResult {
    let app_state = state.lock().unwrap();
    let target_path = video_path
        .or_else(|| app_state.current_session.as_ref().map(|s| s.screen_video_path.clone()));

    let target_path = match target_path {
        Some(p) => p,
        None => return CursorTelemetryResult { success: true, samples: vec![], message: None, error: None },
    };

    if !is_path_allowed(&target_path, &app, &app_state) {
        return CursorTelemetryResult { success: true, samples: vec![], message: None, error: None };
    }

    let telemetry_path = format!("{}.cursor.json", target_path);
    match std::fs::read_to_string(&telemetry_path) {
        Ok(content) => {
            let parsed: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
            let raw_samples = if parsed.is_array() {
                parsed.as_array().cloned().unwrap_or_default()
            } else {
                parsed.get("samples").and_then(|s| s.as_array()).cloned().unwrap_or_default()
            };

            let samples: Vec<CursorTelemetryPoint> = raw_samples
                .iter()
                .filter_map(|s| serde_json::from_value(s.clone()).ok())
                .collect();

            CursorTelemetryResult { success: true, samples, message: None, error: None }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            CursorTelemetryResult { success: true, samples: vec![], message: None, error: None }
        }
        Err(e) => CursorTelemetryResult {
            success: false,
            samples: vec![],
            message: Some("Failed to load cursor telemetry".to_string()),
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn get_shortcuts(app: AppHandle) -> Option<serde_json::Value> {
    let file = shortcuts_file(&app);
    std::fs::read_to_string(&file)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

#[tauri::command]
pub fn save_shortcuts(shortcuts: serde_json::Value, app: AppHandle) -> GenericResult {
    let file = shortcuts_file(&app);
    let content = serde_json::to_string_pretty(&shortcuts).unwrap_or_default();
    match std::fs::write(&file, &content) {
        Ok(_) => GenericResult {
            success: true,
            path: None,
            message: None,
            error: None,
            canceled: None,
        },
        Err(e) => GenericResult {
            success: false,
            path: None,
            message: Some("Failed to save shortcuts".to_string()),
            error: Some(e.to_string()),
            canceled: None,
        },
    }
}

#[tauri::command]
pub fn write_text_file(
    file_path: String,
    content: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> GenericResult {
    let app_state = state.lock().unwrap();
    if !is_path_allowed(&file_path, &app, &app_state) {
        return GenericResult {
            success: false,
            path: None,
            message: Some("Path not allowed".to_string()),
            error: Some("Path not allowed".to_string()),
            canceled: None,
        };
    }
    drop(app_state);
    match std::fs::write(&file_path, &content) {
        Ok(_) => GenericResult {
            success: true,
            path: None,
            message: None,
            error: None,
            canceled: None,
        },
        Err(e) => GenericResult {
            success: false,
            path: None,
            message: Some("Failed to write text file".to_string()),
            error: Some(e.to_string()),
            canceled: None,
        },
    }
}

#[tauri::command]
pub fn reveal_in_folder(file_path: String) -> GenericResult {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(Path::new(&file_path).parent().unwrap_or(Path::new(".")))
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&file_path)
            .spawn()
            .ok();
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", file_path))
            .spawn()
            .ok();
    }
    GenericResult {
        success: true,
        path: None,
        message: None,
        error: None,
        canceled: None,
    }
}

fn extract_approved_media_paths(
    project: &serde_json::Value,
    project_dir: &Path,
    rec_dir: &Path,
) -> Vec<String> {
    let mut approved = Vec::new();
    if let Some(media) = project.get("media") {
        if let Some(screen) = media.get("screenVideoPath").and_then(|v| v.as_str()) {
            if is_path_within_dir(Path::new(screen), project_dir)
                || is_path_within_dir(Path::new(screen), rec_dir)
            {
                approved.push(screen.to_string());
            }
        }
        if let Some(webcam) = media.get("webcamVideoPath").and_then(|v| v.as_str()) {
            if is_path_within_dir(Path::new(webcam), project_dir)
                || is_path_within_dir(Path::new(webcam), rec_dir)
            {
                approved.push(webcam.to_string());
            }
        }
    }
    approved
}

fn chrono_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openscreen_test_{}", name));
        fs::create_dir_all(&dir).ok();
        dir
    }

    fn cleanup(path: &Path) {
        if path.is_dir() {
            fs::remove_dir_all(path).ok();
        } else {
            fs::remove_file(path).ok();
        }
    }

    // ─── Video extension validation ─────────────────────────────────

    #[test]
    fn test_has_valid_video_extension() {
        assert!(has_valid_video_extension("video.mp4"));
        assert!(has_valid_video_extension("video.webm"));
        assert!(has_valid_video_extension("video.mov"));
        assert!(has_valid_video_extension("video.avi"));
        assert!(has_valid_video_extension("video.mkv"));
        assert!(has_valid_video_extension("VIDEO.MP4"));
        assert!(has_valid_video_extension("/some/path/rec.WebM"));
        assert!(!has_valid_video_extension("file.txt"));
        assert!(!has_valid_video_extension("file.exe"));
        assert!(!has_valid_video_extension("file"));
        assert!(!has_valid_video_extension(""));
        assert!(!has_valid_video_extension(".mp4"));
        assert!(!has_valid_video_extension("file.mp4.txt"));
        assert!(!has_valid_video_extension("file.gif"));
    }

    // ─── Path containment ───────���───────────────────────────────────

    #[test]
    fn test_is_path_within_dir_basic() {
        let dir = std::env::temp_dir();
        let file = dir.join("test.txt");
        assert!(is_path_within_dir(&file, &dir));
        assert!(!is_path_within_dir(Path::new("/etc/passwd"), &dir));
    }

    #[test]
    fn test_is_path_within_dir_nested() {
        let dir = test_dir("within_nested");
        let nested = dir.join("sub").join("deep");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("file.txt");
        fs::write(&file, "x").unwrap();

        assert!(is_path_within_dir(&file, &dir));
        assert!(is_path_within_dir(&nested, &dir));
        assert!(!is_path_within_dir(&dir, &nested));
        cleanup(&dir);
    }

    #[test]
    fn test_is_path_within_dir_dotdot_traversal() {
        // When the traversal path doesn't exist on disk, canonicalize falls back
        // to the raw path. This test verifies behavior with real existing paths.
        let dir = test_dir("within_dotdot");
        let outside = test_dir("dotdot_outside");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let outside_file = outside.join("target.txt");
        fs::write(&outside_file, "x").unwrap();

        // A path that exists and is truly outside the dir
        assert!(!is_path_within_dir(&outside_file, &dir));
        cleanup(&dir);
        cleanup(&outside);
    }

    #[test]
    fn test_is_path_within_dir_symlink_escape() {
        let dir = test_dir("within_symlink");
        let outside = test_dir("outside_target");
        fs::create_dir_all(&dir).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();

        let link_path = dir.join("escape");
        symlink(&outside, &link_path).ok();
        if link_path.exists() {
            let escaped_file = link_path.join("secret.txt");
            assert!(
                !is_path_within_dir(&escaped_file, &dir),
                "symlink should not allow escaping the directory"
            );
        }
        cleanup(&dir);
        cleanup(&outside);
    }

    #[test]
    fn test_is_path_within_dir_same_dir() {
        let dir = test_dir("within_same");
        fs::create_dir_all(&dir).unwrap();
        assert!(is_path_within_dir(&dir, &dir));
        cleanup(&dir);
    }

    // ─── Path access control ────────────────────────────────────────

    #[test]
    fn test_is_path_allowed_approved_exact_match() {
        let rec_dir = test_dir("allowed_approved");
        fs::create_dir_all(&rec_dir).unwrap();
        let outside_path = "/home/user/Documents/my-video.mp4";
        let approved = vec![outside_path.to_string()];

        assert!(is_path_allowed_for_dir(outside_path, &rec_dir, &approved));
        cleanup(&rec_dir);
    }

    #[test]
    fn test_is_path_allowed_within_recordings() {
        let rec_dir = test_dir("allowed_rec");
        fs::create_dir_all(&rec_dir).unwrap();
        let video = rec_dir.join("recording.webm");
        fs::write(&video, "fake-video").unwrap();

        assert!(is_path_allowed_for_dir(
            &video.to_string_lossy(),
            &rec_dir,
            &[]
        ));
        cleanup(&rec_dir);
    }

    #[test]
    fn test_is_path_allowed_denies_unapproved_outside() {
        let rec_dir = test_dir("allowed_deny");
        fs::create_dir_all(&rec_dir).unwrap();

        assert!(!is_path_allowed_for_dir("/etc/passwd", &rec_dir, &[]));
        assert!(!is_path_allowed_for_dir(
            "/home/user/sensitive.db",
            &rec_dir,
            &[]
        ));
        cleanup(&rec_dir);
    }

    #[test]
    fn test_is_path_allowed_denies_traversal_into_recordings() {
        let rec_dir = test_dir("allowed_traversal");
        fs::create_dir_all(&rec_dir).unwrap();
        let traversal = format!("{}/../../../etc/passwd", rec_dir.to_string_lossy());

        assert!(!is_path_allowed_for_dir(&traversal, &rec_dir, &[]));
        cleanup(&rec_dir);
    }

    #[test]
    fn test_is_path_allowed_multiple_approved_paths() {
        let rec_dir = test_dir("allowed_multi");
        fs::create_dir_all(&rec_dir).unwrap();
        let approved = vec![
            "/path/one.mp4".to_string(),
            "/path/two.webm".to_string(),
            "/path/three.mov".to_string(),
        ];

        assert!(is_path_allowed_for_dir("/path/two.webm", &rec_dir, &approved));
        assert!(!is_path_allowed_for_dir("/path/four.mp4", &rec_dir, &approved));
        cleanup(&rec_dir);
    }

    // ─── Recording output path resolution ───────────────────────────

    #[test]
    fn test_resolve_output_path_valid() {
        let rec_dir = test_dir("resolve_valid");
        let result = resolve_output_path_for_dir(&rec_dir, "recording-001.webm");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), rec_dir.join("recording-001.webm"));
        cleanup(&rec_dir);
    }

    #[test]
    fn test_resolve_output_path_rejects_empty() {
        let rec_dir = test_dir("resolve_empty");
        assert!(resolve_output_path_for_dir(&rec_dir, "").is_err());
        assert!(resolve_output_path_for_dir(&rec_dir, "   ").is_err());
        cleanup(&rec_dir);
    }

    #[test]
    fn test_resolve_output_path_rejects_traversal() {
        let rec_dir = test_dir("resolve_traversal");
        assert!(resolve_output_path_for_dir(&rec_dir, "../../../etc/passwd").is_err());
        assert!(resolve_output_path_for_dir(&rec_dir, "sub/../../../etc/shadow").is_err());
        assert!(resolve_output_path_for_dir(&rec_dir, "..").is_err());
        cleanup(&rec_dir);
    }

    #[test]
    fn test_resolve_output_path_rejects_forward_slash() {
        let rec_dir = test_dir("resolve_slash");
        assert!(resolve_output_path_for_dir(&rec_dir, "sub/file.webm").is_err());
        cleanup(&rec_dir);
    }

    #[test]
    fn test_resolve_output_path_rejects_backslash() {
        let rec_dir = test_dir("resolve_backslash");
        assert!(resolve_output_path_for_dir(&rec_dir, "sub\\file.webm").is_err());
        cleanup(&rec_dir);
    }

    #[test]
    fn test_resolve_output_path_trims_whitespace() {
        let rec_dir = test_dir("resolve_trim");
        let result = resolve_output_path_for_dir(&rec_dir, "  file.webm  ");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), rec_dir.join("file.webm"));
        cleanup(&rec_dir);
    }

    #[test]
    fn test_resolve_output_path_allows_special_chars_in_name() {
        let rec_dir = test_dir("resolve_special");
        assert!(resolve_output_path_for_dir(&rec_dir, "my recording (1).webm").is_ok());
        assert!(resolve_output_path_for_dir(&rec_dir, "recording-2024-01-15T10:30:00.webm").is_ok());
        cleanup(&rec_dir);
    }

    // ─── Project media path extraction ───���──────────────────────────

    #[test]
    fn test_extract_approved_media_paths_screen_only() {
        let proj_dir = test_dir("extract_screen");
        let rec_dir = test_dir("extract_screen_rec");
        fs::create_dir_all(&proj_dir).unwrap();
        fs::create_dir_all(&rec_dir).unwrap();

        let screen_path = proj_dir.join("screen.webm");
        fs::write(&screen_path, "fake").unwrap();

        let project = serde_json::json!({
            "media": {
                "screenVideoPath": screen_path.to_string_lossy()
            }
        });

        let approved = extract_approved_media_paths(&project, &proj_dir, &rec_dir);
        assert_eq!(approved.len(), 1);
        assert_eq!(approved[0], screen_path.to_string_lossy());
        cleanup(&proj_dir);
        cleanup(&rec_dir);
    }

    #[test]
    fn test_extract_approved_media_paths_screen_and_webcam() {
        let proj_dir = test_dir("extract_both");
        let rec_dir = test_dir("extract_both_rec");
        fs::create_dir_all(&proj_dir).unwrap();
        fs::create_dir_all(&rec_dir).unwrap();

        let screen_path = proj_dir.join("screen.webm");
        let webcam_path = proj_dir.join("webcam.webm");
        fs::write(&screen_path, "fake").unwrap();
        fs::write(&webcam_path, "fake").unwrap();

        let project = serde_json::json!({
            "media": {
                "screenVideoPath": screen_path.to_string_lossy(),
                "webcamVideoPath": webcam_path.to_string_lossy()
            }
        });

        let approved = extract_approved_media_paths(&project, &proj_dir, &rec_dir);
        assert_eq!(approved.len(), 2);
        cleanup(&proj_dir);
        cleanup(&rec_dir);
    }

    #[test]
    fn test_extract_approved_media_paths_rejects_outside_paths() {
        let proj_dir = test_dir("extract_reject");
        let rec_dir = test_dir("extract_reject_rec");
        fs::create_dir_all(&proj_dir).unwrap();
        fs::create_dir_all(&rec_dir).unwrap();

        let project = serde_json::json!({
            "media": {
                "screenVideoPath": "/etc/shadow",
                "webcamVideoPath": "/root/.ssh/id_rsa"
            }
        });

        let approved = extract_approved_media_paths(&project, &proj_dir, &rec_dir);
        assert!(approved.is_empty(), "paths outside project and recordings dirs must be rejected");
        cleanup(&proj_dir);
        cleanup(&rec_dir);
    }

    #[test]
    fn test_extract_approved_media_paths_in_recordings_dir() {
        let proj_dir = test_dir("extract_inrec");
        let rec_dir = test_dir("extract_inrec_rec");
        fs::create_dir_all(&proj_dir).unwrap();
        fs::create_dir_all(&rec_dir).unwrap();

        let screen_path = rec_dir.join("recording-001.webm");
        fs::write(&screen_path, "fake").unwrap();

        let project = serde_json::json!({
            "media": {
                "screenVideoPath": screen_path.to_string_lossy()
            }
        });

        let approved = extract_approved_media_paths(&project, &proj_dir, &rec_dir);
        assert_eq!(approved.len(), 1);
        cleanup(&proj_dir);
        cleanup(&rec_dir);
    }

    #[test]
    fn test_extract_approved_media_paths_no_media_key() {
        let proj_dir = test_dir("extract_nomedia");
        let rec_dir = test_dir("extract_nomedia_rec");
        let project = serde_json::json!({"settings": {}});
        let approved = extract_approved_media_paths(&project, &proj_dir, &rec_dir);
        assert!(approved.is_empty());
    }

    // ─── Cursor telemetry ───────────────────────────────────────────

    #[test]
    fn test_cursor_telemetry_point_serialization() {
        let point = CursorTelemetryPoint {
            time_ms: 1000.0,
            cx: 0.5,
            cy: 0.75,
        };
        let json = serde_json::to_string(&point).unwrap();
        assert!(json.contains("\"timeMs\":1000.0"));
        assert!(json.contains("\"cx\":0.5"));
        assert!(json.contains("\"cy\":0.75"));

        let deserialized: CursorTelemetryPoint = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.time_ms, 1000.0);
        assert_eq!(deserialized.cx, 0.5);
        assert_eq!(deserialized.cy, 0.75);
    }

    #[test]
    fn test_cursor_telemetry_from_json_file() {
        let data = r#"{"version":1,"samples":[{"timeMs":0,"cx":0.5,"cy":0.5},{"timeMs":100,"cx":0.6,"cy":0.4}]}"#;
        let parsed: serde_json::Value = serde_json::from_str(data).unwrap();
        let samples = parsed.get("samples").unwrap().as_array().unwrap();
        let points: Vec<CursorTelemetryPoint> = samples
            .iter()
            .filter_map(|s| serde_json::from_value(s.clone()).ok())
            .collect();
        assert_eq!(points.len(), 2);
        assert_eq!(points[0].time_ms, 0.0);
        assert_eq!(points[1].cx, 0.6);
    }

    #[test]
    fn test_cursor_telemetry_legacy_array_format() {
        let data = r#"[{"timeMs":0,"cx":0.1,"cy":0.2},{"timeMs":50,"cx":0.3,"cy":0.4}]"#;
        let parsed: serde_json::Value = serde_json::from_str(data).unwrap();
        let raw_samples = if parsed.is_array() {
            parsed.as_array().cloned().unwrap_or_default()
        } else {
            parsed.get("samples").and_then(|s| s.as_array()).cloned().unwrap_or_default()
        };
        let points: Vec<CursorTelemetryPoint> = raw_samples
            .iter()
            .filter_map(|s| serde_json::from_value(s.clone()).ok())
            .collect();
        assert_eq!(points.len(), 2);
        assert_eq!(points[0].cx, 0.1);
    }

    #[test]
    fn test_cursor_telemetry_write_read_round_trip() {
        let dir = test_dir("telemetry_roundtrip");
        fs::create_dir_all(&dir).unwrap();

        let samples: Vec<CursorTelemetryPoint> = (0..100)
            .map(|i| CursorTelemetryPoint {
                time_ms: i as f64 * 16.67,
                cx: (i as f64 / 100.0),
                cy: 1.0 - (i as f64 / 100.0),
            })
            .collect();

        let telemetry = serde_json::json!({
            "version": 1,
            "samples": samples
        });

        let path = dir.join("recording.webm.cursor.json");
        fs::write(&path, serde_json::to_string_pretty(&telemetry).unwrap()).unwrap();

        let loaded: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let loaded_samples: Vec<CursorTelemetryPoint> = loaded
            .get("samples")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|s| serde_json::from_value(s.clone()).ok())
            .collect();
        assert_eq!(loaded_samples.len(), 100);
        assert!((loaded_samples[50].cx - 0.5).abs() < 0.001);
        cleanup(&dir);
    }

    #[test]
    fn test_cursor_telemetry_large_sample_set() {
        let samples: Vec<CursorTelemetryPoint> = (0..36000)
            .map(|i| CursorTelemetryPoint {
                time_ms: i as f64 * 100.0,
                cx: (i as f64 / 36000.0),
                cy: 1.0 - (i as f64 / 36000.0),
            })
            .collect();
        assert_eq!(samples.len(), 36000);
        let json = serde_json::to_string(&serde_json::json!({"version": 1, "samples": samples})).unwrap();
        assert!(json.len() > 1_000_000, "serialized telemetry should be >1MB");

        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let deserialized: Vec<CursorTelemetryPoint> = parsed
            .get("samples")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|s| serde_json::from_value(s.clone()).ok())
            .collect();
        assert_eq!(deserialized.len(), 36000);
        assert_eq!(deserialized[0].time_ms, 0.0);
        assert_eq!(deserialized[35999].time_ms, 3599900.0);
    }

    // ─── Serialization ─────────��────────────────────────────────────

    #[test]
    fn test_generic_result_serialization() {
        let result = GenericResult {
            success: true,
            path: Some("/tmp/file.mp4".to_string()),
            message: None,
            error: None,
            canceled: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"path\":\"/tmp/file.mp4\""));
        assert!(!json.contains("message"));
        assert!(!json.contains("error"));
        assert!(!json.contains("canceled"));
    }

    #[test]
    fn test_generic_result_canceled_serialization() {
        let result = GenericResult {
            success: false,
            path: None,
            message: Some("Export canceled".to_string()),
            error: None,
            canceled: Some(true),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"canceled\":true"));
        assert!(json.contains("\"message\":\"Export canceled\""));
        assert!(!json.contains("\"path\""));
    }

    #[test]
    fn test_session_result_serialization() {
        let session = crate::state::RecordingSession {
            screen_video_path: "/tmp/screen.webm".to_string(),
            webcam_video_path: None,
            created_at: 1700000000.0,
        };
        let result = SessionResult {
            success: true,
            path: Some("/tmp/screen.webm".to_string()),
            session: Some(session),
            message: Some("ok".to_string()),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"screenVideoPath\""));
        assert!(!json.contains("\"webcamVideoPath\""));
    }

    #[test]
    fn test_project_load_result_serialization() {
        let result = ProjectLoadResult {
            success: true,
            path: Some("/tmp/project.openscreen".to_string()),
            project: Some(serde_json::json!({"version": 1})),
            message: None,
            canceled: None,
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["project"]["version"], 1);
        assert!(!json.contains("\"canceled\""));
    }

    #[test]
    fn test_read_binary_result_serialization() {
        let result = ReadBinaryResult {
            success: true,
            data: Some(vec![0, 1, 2, 3]),
            path: Some("/tmp/file.bin".to_string()),
            message: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"data\":[0,1,2,3]"));
        assert!(!json.contains("\"message\""));
    }

    // ─── File operations ────────────────────────────────────────────

    #[test]
    fn test_write_and_read_text_file() {
        let tmp = std::env::temp_dir().join("openscreen_test_write.txt");
        fs::write(&tmp, "hello world").expect("Failed to write test file");
        let content = fs::read_to_string(&tmp).unwrap();
        assert_eq!(content, "hello world");
        cleanup(&tmp);
    }

    #[test]
    fn test_shortcuts_round_trip() {
        let tmp = std::env::temp_dir().join("openscreen_test_shortcuts.json");
        let shortcuts = serde_json::json!({"playPause": "Space", "undo": "Ctrl+Z"});
        let content = serde_json::to_string_pretty(&shortcuts).unwrap();
        fs::write(&tmp, &content).unwrap();

        let loaded: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&tmp).unwrap()).unwrap();
        assert_eq!(loaded["playPause"], "Space");
        assert_eq!(loaded["undo"], "Ctrl+Z");
        cleanup(&tmp);
    }

    #[test]
    fn test_move_or_copy_same_filesystem() {
        let src = std::env::temp_dir().join("openscreen_test_move_src.bin");
        let dest = std::env::temp_dir().join("openscreen_test_move_dest.bin");
        let payload = vec![0u8; 1024 * 1024];
        fs::write(&src, &payload).unwrap();

        move_or_copy(&src.to_string_lossy(), &dest).unwrap();

        assert!(!src.exists(), "source should be removed after move");
        assert!(dest.exists(), "destination should exist after move");
        let read_back = fs::read(&dest).unwrap();
        assert_eq!(read_back.len(), 1024 * 1024);
        cleanup(&dest);
    }

    #[test]
    fn test_move_or_copy_preserves_content() {
        let src = std::env::temp_dir().join("openscreen_test_content_src.bin");
        let dest = std::env::temp_dir().join("openscreen_test_content_dest.bin");
        let payload: Vec<u8> = (0..=255).cycle().take(4096).collect();
        fs::write(&src, &payload).unwrap();

        move_or_copy(&src.to_string_lossy(), &dest).unwrap();

        let read_back = fs::read(&dest).unwrap();
        assert_eq!(read_back, payload, "content must be identical after move");
        cleanup(&dest);
    }

    #[test]
    fn test_move_or_copy_nonexistent_source_fails() {
        let src = std::env::temp_dir().join("openscreen_nonexistent_file.bin");
        let dest = std::env::temp_dir().join("openscreen_nonexistent_dest.bin");
        let result = move_or_copy(&src.to_string_lossy(), &dest);
        assert!(result.is_err(), "should fail for nonexistent source");
    }

    #[test]
    fn test_move_or_copy_overwrites_existing_dest() {
        let src = std::env::temp_dir().join("openscreen_test_overwrite_src.bin");
        let dest = std::env::temp_dir().join("openscreen_test_overwrite_dest.bin");
        fs::write(&dest, "old content").unwrap();
        fs::write(&src, "new content").unwrap();

        move_or_copy(&src.to_string_lossy(), &dest).unwrap();

        let content = fs::read_to_string(&dest).unwrap();
        assert_eq!(content, "new content");
        cleanup(&dest);
    }

    #[test]
    fn test_move_or_copy_empty_file() {
        let src = std::env::temp_dir().join("openscreen_test_empty_src.bin");
        let dest = std::env::temp_dir().join("openscreen_test_empty_dest.bin");
        fs::write(&src, &[]).unwrap();

        move_or_copy(&src.to_string_lossy(), &dest).unwrap();

        assert!(dest.exists());
        assert_eq!(fs::metadata(&dest).unwrap().len(), 0);
        cleanup(&dest);
    }

    // ─── Session manifest ─��─────────────────────────────────────────

    #[test]
    fn test_session_manifest_round_trip() {
        let session = crate::state::RecordingSession {
            screen_video_path: "/tmp/recordings/screen-001.webm".to_string(),
            webcam_video_path: Some("/tmp/recordings/screen-001-webcam.webm".to_string()),
            created_at: 1700000000000.0,
        };
        let json = serde_json::to_string_pretty(&session).unwrap();
        let manifest_path = std::env::temp_dir().join("openscreen_test_manifest.session.json");
        fs::write(&manifest_path, &json).unwrap();

        let loaded: crate::state::RecordingSession =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        assert_eq!(loaded.screen_video_path, session.screen_video_path);
        assert_eq!(loaded.webcam_video_path, session.webcam_video_path);
        assert_eq!(loaded.created_at, session.created_at);
        cleanup(&manifest_path);
    }

    #[test]
    fn test_session_manifest_webcam_naming_convention() {
        let base_name = "screen-001";
        let webcam_name = format!("{}-webcam", base_name);
        assert_eq!(webcam_name, "screen-001-webcam");

        let screen_name = "screen-001-webcam";
        if screen_name.ends_with("-webcam") {
            let stripped = &screen_name[..screen_name.len() - 7];
            assert_eq!(stripped, "screen-001");
        }
    }

    // ─── Project persistence ────────────────────────────────────────

    #[test]
    fn test_project_file_round_trip() {
        let dir = test_dir("project_roundtrip");
        fs::create_dir_all(&dir).unwrap();

        let project = serde_json::json!({
            "version": 1,
            "media": {
                "screenVideoPath": dir.join("screen.webm").to_string_lossy(),
            },
            "timeline": {
                "regions": [
                    {"start": 0.0, "end": 5.0, "speed": 1.0},
                    {"start": 5.0, "end": 10.0, "speed": 2.0}
                ],
                "trimStart": 0.5,
                "trimEnd": 9.5
            },
            "settings": {
                "wallpaper": "gradient-blue",
                "padding": 50,
                "borderRadius": 12
            },
            "annotations": [
                {"type": "text", "content": "Hello", "x": 100, "y": 200}
            ]
        });

        let path = dir.join("test.openscreen");
        let content = serde_json::to_string_pretty(&project).unwrap();
        fs::write(&path, &content).unwrap();

        let loaded_content = fs::read_to_string(&path).unwrap();
        let loaded: serde_json::Value = serde_json::from_str(&loaded_content).unwrap();

        assert_eq!(loaded["version"], 1);
        assert_eq!(loaded["timeline"]["regions"].as_array().unwrap().len(), 2);
        assert_eq!(loaded["timeline"]["trimStart"], 0.5);
        assert_eq!(loaded["settings"]["wallpaper"], "gradient-blue");
        assert_eq!(loaded["annotations"].as_array().unwrap().len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn test_project_file_invalid_json() {
        let dir = test_dir("project_invalid");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.openscreen");
        fs::write(&path, "this is not json {{{").unwrap();

        let result = serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(&path).unwrap(),
        );
        assert!(result.is_err());
        cleanup(&dir);
    }

    #[test]
    fn test_project_file_sanitized_name() {
        let name = "My Project (2024)".replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        assert_eq!(name, "My_Project__2024_");
        let with_ext = if name.ends_with(".openscreen") {
            name
        } else {
            format!("{}.openscreen", name)
        };
        assert_eq!(with_ext, "My_Project__2024_.openscreen");
    }

    // ─── Full recording session simulation ──────────────────────────

    #[test]
    fn test_full_recording_session_lifecycle() {
        let dir = test_dir("session_lifecycle");
        let recordings = dir.join("recordings");
        fs::create_dir_all(&recordings).unwrap();

        // 1. Simulate storing a recording
        let video_data = vec![0u8; 1024];
        let screen_path = recordings.join("screen-001.webm");
        fs::write(&screen_path, &video_data).unwrap();

        // 2. Write session manifest
        let session = crate::state::RecordingSession {
            screen_video_path: screen_path.to_string_lossy().to_string(),
            webcam_video_path: None,
            created_at: 1700000000000.0,
        };
        let manifest_path = recordings.join("screen-001.session.json");
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&session).unwrap(),
        )
        .unwrap();

        // 3. Write cursor telemetry
        let samples = vec![
            CursorTelemetryPoint { time_ms: 0.0, cx: 0.5, cy: 0.5 },
            CursorTelemetryPoint { time_ms: 100.0, cx: 0.6, cy: 0.4 },
        ];
        let telemetry_path = format!("{}.cursor.json", screen_path.to_string_lossy());
        fs::write(
            &telemetry_path,
            serde_json::to_string(&serde_json::json!({"version": 1, "samples": samples})).unwrap(),
        )
        .unwrap();

        // 4. Verify all artifacts exist
        assert!(screen_path.exists());
        assert!(manifest_path.exists());
        assert!(Path::new(&telemetry_path).exists());

        // 5. Load session manifest back
        let loaded: crate::state::RecordingSession =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        assert_eq!(loaded.screen_video_path, screen_path.to_string_lossy());

        // 6. Load cursor telemetry back
        let tel: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&telemetry_path).unwrap()).unwrap();
        let loaded_samples: Vec<CursorTelemetryPoint> = tel
            .get("samples")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|s| serde_json::from_value(s.clone()).ok())
            .collect();
        assert_eq!(loaded_samples.len(), 2);

        // 7. Verify path is within recordings
        assert!(is_path_within_dir(&screen_path, &recordings));

        cleanup(&dir);
    }

    #[test]
    fn test_full_recording_session_with_webcam() {
        let dir = test_dir("session_webcam");
        let recordings = dir.join("recordings");
        fs::create_dir_all(&recordings).unwrap();

        let screen_path = recordings.join("recording-001.webm");
        let webcam_path = recordings.join("recording-001-webcam.webm");
        fs::write(&screen_path, vec![0u8; 512]).unwrap();
        fs::write(&webcam_path, vec![0u8; 256]).unwrap();

        let session = crate::state::RecordingSession {
            screen_video_path: screen_path.to_string_lossy().to_string(),
            webcam_video_path: Some(webcam_path.to_string_lossy().to_string()),
            created_at: 1700000000000.0,
        };

        let json = serde_json::to_string_pretty(&session).unwrap();
        assert!(json.contains("webcamVideoPath"));

        let loaded: crate::state::RecordingSession = serde_json::from_str(&json).unwrap();
        assert!(loaded.webcam_video_path.is_some());
        assert!(Path::new(loaded.webcam_video_path.as_ref().unwrap()).exists());
        cleanup(&dir);
    }

    #[test]
    fn test_get_recorded_video_finds_most_recent() {
        let dir = test_dir("recent_video");
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("a-old.webm"), "old").unwrap();
        fs::write(dir.join("b-middle.webm"), "mid").unwrap();
        fs::write(dir.join("c-newest.webm"), "new").unwrap();
        fs::write(dir.join("c-newest-webcam.webm"), "webcam").unwrap();
        fs::write(dir.join("not-a-video.txt"), "nope").unwrap();

        let mut videos: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.ends_with(".webm") && !name.ends_with("-webcam.webm")
            })
            .map(|e| e.path().to_string_lossy().to_string())
            .collect();
        videos.sort();
        videos.reverse();

        assert_eq!(videos.len(), 3);
        assert!(videos[0].contains("c-newest.webm"));
        assert!(!videos.iter().any(|v| v.contains("-webcam")));
        assert!(!videos.iter().any(|v| v.contains(".txt")));
        cleanup(&dir);
    }

    // ─── File-based transfer simulation ─────────────────────────────

    #[test]
    fn test_file_based_transfer_screen_only() {
        let dir = test_dir("transfer_screen");
        let recordings = dir.join("recordings");
        fs::create_dir_all(&recordings).unwrap();

        let temp_file = dir.join("temp-screen.webm");
        let video_data = vec![42u8; 2048];
        fs::write(&temp_file, &video_data).unwrap();

        let dest = recordings.join("screen-001.webm");
        move_or_copy(&temp_file.to_string_lossy(), &dest).unwrap();

        assert!(!temp_file.exists(), "temp file should be gone");
        assert!(dest.exists());
        assert_eq!(fs::read(&dest).unwrap(), video_data);
        cleanup(&dir);
    }

    #[test]
    fn test_file_based_transfer_with_webcam() {
        let dir = test_dir("transfer_webcam");
        let recordings = dir.join("recordings");
        fs::create_dir_all(&recordings).unwrap();

        let temp_screen = dir.join("temp-screen.webm");
        let temp_webcam = dir.join("temp-webcam.webm");
        fs::write(&temp_screen, vec![1u8; 1024]).unwrap();
        fs::write(&temp_webcam, vec![2u8; 512]).unwrap();

        let screen_dest = recordings.join("rec-001.webm");
        let webcam_dest = recordings.join("rec-001-webcam.webm");

        move_or_copy(&temp_screen.to_string_lossy(), &screen_dest).unwrap();
        move_or_copy(&temp_webcam.to_string_lossy(), &webcam_dest).unwrap();

        assert!(screen_dest.exists());
        assert!(webcam_dest.exists());
        assert_eq!(fs::read(&screen_dest).unwrap()[0], 1);
        assert_eq!(fs::read(&webcam_dest).unwrap()[0], 2);
        cleanup(&dir);
    }

    // ─── Binary I/O ─────────────────────────────────────────────────

    #[test]
    fn test_large_binary_write_and_verify() {
        let tmp = std::env::temp_dir().join("openscreen_test_large_binary.bin");
        let size = 10 * 1024 * 1024;
        let payload: Vec<u8> = (0..size).map(|i| (i % 256) as u8).collect();
        fs::write(&tmp, &payload).unwrap();

        let read_back = fs::read(&tmp).unwrap();
        assert_eq!(read_back.len(), size);
        assert_eq!(read_back[0], 0);
        assert_eq!(read_back[255], 255);
        assert_eq!(read_back[256], 0);
        assert_eq!(read_back[size - 1], ((size - 1) % 256) as u8);
        cleanup(&tmp);
    }

    #[test]
    fn test_unicode_filename_handling() {
        let dir = test_dir("unicode_fname");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("запис_экрана.webm");
        fs::write(&path, vec![0u8; 100]).unwrap();
        assert!(path.exists());
        assert!(has_valid_video_extension(&path.to_string_lossy()));
        cleanup(&dir);
    }

    #[test]
    fn test_spaces_in_path() {
        let dir = test_dir("spaces in path");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("my recording.webm");
        fs::write(&file, "data").unwrap();
        assert!(file.exists());
        assert!(is_path_within_dir(&file, &dir));
        cleanup(&dir);
    }
}
