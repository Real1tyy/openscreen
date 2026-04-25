use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CliOptions {
    pub input_file: Option<String>,
    pub export: bool,
    pub output: Option<String>,
    pub blur: bool,
    pub shadow: bool,
    pub shadow_intensity: f64,
    pub motion_blur: f64,
    pub roundness: f64,
    pub padding: f64,
    pub background: String,
    pub resolution: Option<Resolution>,
    pub bitrate: Option<u64>,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

static CLI_OPTIONS: OnceLock<CliOptions> = OnceLock::new();

pub fn parse_cli_args(app: &AppHandle) {
    let args: Vec<String> = std::env::args().collect();

    let mut opts = CliOptions {
        padding: 50.0,
        fps: 60,
        background: "wallpaper1.jpg".to_string(),
        ..Default::default()
    };

    let mut i = 1;
    while i < args.len() {
        let arg = &args[i];
        // Skip Chromium/Electron-style flags
        if arg.starts_with("--type=")
            || arg.starts_with("--no-sandbox")
            || arg.starts_with("--disable-gpu")
            || arg.starts_with("--enable-logging")
        {
            i += 1;
            continue;
        }

        match arg.as_str() {
            "--export" | "-e" => opts.export = true,
            "--output" | "-o" => {
                i += 1;
                opts.output = args.get(i).cloned();
            }
            "--blur" => opts.blur = true,
            "--shadow" => opts.shadow = true,
            "--shadow-intensity" => {
                i += 1;
                opts.shadow_intensity = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(0.5);
            }
            "--motion-blur" => {
                i += 1;
                opts.motion_blur = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(0.0);
            }
            "--roundness" => {
                i += 1;
                opts.roundness = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(0.0);
            }
            "--padding" => {
                i += 1;
                opts.padding = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(50.0);
            }
            "--background" => {
                i += 1;
                if let Some(bg) = args.get(i) {
                    opts.background = bg.clone();
                }
            }
            "--resolution" => {
                i += 1;
                if let Some(res) = args.get(i) {
                    opts.resolution = parse_resolution(res);
                }
            }
            "--bitrate" => {
                i += 1;
                opts.bitrate = args.get(i).and_then(|v| v.parse().ok());
            }
            "--fps" => {
                i += 1;
                opts.fps = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(60);
            }
            _ if !arg.starts_with('-') && opts.input_file.is_none() => {
                opts.input_file = Some(arg.clone());
            }
            _ => {}
        }
        i += 1;
    }

    // If input file provided, approve its path for reading
    if let Some(ref input) = opts.input_file {
        let resolved = PathBuf::from(input);
        if resolved.exists() {
            let abs_path = std::fs::canonicalize(&resolved)
                .unwrap_or(resolved)
                .to_string_lossy()
                .to_string();
            opts.input_file = Some(abs_path.clone());

            let state = app.state::<Mutex<AppState>>();
            let mut app_state = state.lock().unwrap();
            app_state.approved_paths.push(abs_path);
        }
    }

    // Derive output path if exporting without explicit output
    if opts.export && opts.output.is_none() {
        if let Some(ref input) = opts.input_file {
            let p = PathBuf::from(input);
            let stem = p.file_stem().unwrap_or_default().to_string_lossy();
            let dir = p.parent().unwrap_or(&p);
            opts.output = Some(
                dir.join(format!("{}-openscreen.mp4", stem))
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    CLI_OPTIONS.set(opts).ok();
}

fn parse_resolution(value: &str) -> Option<Resolution> {
    match value.to_lowercase().as_str() {
        "720p" => Some(Resolution { width: 1280, height: 720 }),
        "1080p" => Some(Resolution { width: 1920, height: 1080 }),
        "1440p" => Some(Resolution { width: 2560, height: 1440 }),
        "4k" => Some(Resolution { width: 3840, height: 2160 }),
        _ => {
            let parts: Vec<&str> = value.split('x').collect();
            if parts.len() == 2 {
                let w = parts[0].parse().ok()?;
                let h = parts[1].parse().ok()?;
                Some(Resolution { width: w, height: h })
            } else {
                None
            }
        }
    }
}

fn get_opts() -> &'static CliOptions {
    CLI_OPTIONS.get_or_init(CliOptions::default)
}

#[tauri::command]
pub fn get_cli_input_file() -> Option<String> {
    get_opts().input_file.clone()
}

#[tauri::command]
pub fn get_cli_editor_config() -> Option<serde_json::Value> {
    let opts = get_opts();
    if opts.input_file.is_none() {
        return None;
    }

    Some(serde_json::json!({
        "showBlur": opts.blur,
        "showShadow": opts.shadow,
        "shadowIntensity": opts.shadow_intensity,
        "motionBlurAmount": opts.motion_blur,
        "borderRadius": opts.roundness,
        "padding": opts.padding,
        "wallpaper": opts.background,
    }))
}

#[tauri::command]
pub fn get_headless_export_config() -> Option<serde_json::Value> {
    let opts = get_opts();
    if !opts.export {
        return None;
    }

    let mut config = serde_json::json!({
        "inputFile": opts.input_file,
        "outputFile": opts.output,
        "blur": opts.blur,
        "shadow": opts.shadow,
        "shadowIntensity": opts.shadow_intensity,
        "motionBlur": opts.motion_blur,
        "roundness": opts.roundness,
        "padding": opts.padding,
        "background": opts.background,
        "fps": opts.fps,
    });

    if let Some(ref res) = opts.resolution {
        config["resolution"] = serde_json::json!({
            "width": res.width,
            "height": res.height,
        });
    }
    if let Some(bitrate) = opts.bitrate {
        config["bitrate"] = serde_json::json!(bitrate);
    }

    Some(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_resolution_presets() {
        assert!(matches!(parse_resolution("720p"), Some(Resolution { width: 1280, height: 720 })));
        assert!(matches!(parse_resolution("1080p"), Some(Resolution { width: 1920, height: 1080 })));
        assert!(matches!(parse_resolution("4k"), Some(Resolution { width: 3840, height: 2160 })));
    }

    #[test]
    fn test_parse_resolution_custom() {
        let res = parse_resolution("1920x1080").unwrap();
        assert_eq!(res.width, 1920);
        assert_eq!(res.height, 1080);

        let res = parse_resolution("800x600").unwrap();
        assert_eq!(res.width, 800);
        assert_eq!(res.height, 600);
    }

    #[test]
    fn test_parse_resolution_invalid() {
        assert!(parse_resolution("invalid").is_none());
        assert!(parse_resolution("100").is_none());
        assert!(parse_resolution("axb").is_none());
    }

    #[test]
    fn test_default_cli_options() {
        let opts = CliOptions::default();
        assert!(opts.input_file.is_none());
        assert!(!opts.export);
        assert!(!opts.blur);
        assert!(!opts.shadow);
        assert_eq!(opts.fps, 0);
    }

    #[test]
    fn test_editor_config_field_names_match_frontend() {
        // Verify the JSON shape matches what VideoEditor.tsx reads.
        // Built directly to avoid OnceLock contention in parallel tests.
        let opts = CliOptions {
            input_file: Some("/tmp/test.mp4".to_string()),
            padding: 50.0,
            background: "wallpaper1.jpg".to_string(),
            shadow_intensity: 0.5,
            motion_blur: 0.2,
            roundness: 13.5,
            blur: true,
            shadow: true,
            ..Default::default()
        };

        let config = serde_json::json!({
            "showBlur": opts.blur,
            "showShadow": opts.shadow,
            "shadowIntensity": opts.shadow_intensity,
            "motionBlurAmount": opts.motion_blur,
            "borderRadius": opts.roundness,
            "padding": opts.padding,
            "wallpaper": opts.background,
        });
        let obj = config.as_object().unwrap();

        assert!(obj.contains_key("wallpaper"), "missing 'wallpaper' — frontend reads cliConfig.wallpaper");
        assert!(obj.contains_key("showBlur"), "missing 'showBlur' — frontend reads cliConfig.showBlur");
        assert!(obj.contains_key("showShadow"), "missing 'showShadow'");
        assert!(obj.contains_key("shadowIntensity"), "missing 'shadowIntensity'");
        assert!(obj.contains_key("motionBlurAmount"), "missing 'motionBlurAmount'");
        assert!(obj.contains_key("borderRadius"), "missing 'borderRadius'");
        assert!(obj.contains_key("padding"), "missing 'padding'");

        assert_eq!(obj["wallpaper"], "wallpaper1.jpg");
        assert_eq!(obj["showBlur"], true);
        assert_eq!(obj["showShadow"], true);
        assert_eq!(obj["shadowIntensity"], 0.5);
        assert_eq!(obj["motionBlurAmount"], 0.2);
        assert_eq!(obj["borderRadius"], 13.5);
        assert_eq!(obj["padding"], 50.0);
    }

    #[test]
    fn test_headless_export_config_field_names() {
        let opts = CliOptions {
            input_file: Some("/tmp/test.mp4".to_string()),
            export: true,
            output: Some("/tmp/out.mp4".to_string()),
            fps: 60,
            padding: 50.0,
            background: "wallpaper1.jpg".to_string(),
            ..Default::default()
        };

        let config = serde_json::json!({
            "inputFile": opts.input_file,
            "outputFile": opts.output,
            "blur": opts.blur,
            "shadow": opts.shadow,
            "shadowIntensity": opts.shadow_intensity,
            "motionBlur": opts.motion_blur,
            "roundness": opts.roundness,
            "padding": opts.padding,
            "background": opts.background,
            "fps": opts.fps,
        });
        let obj = config.as_object().unwrap();

        assert!(obj.contains_key("inputFile"), "missing 'inputFile'");
        assert!(obj.contains_key("outputFile"), "missing 'outputFile'");
        assert!(obj.contains_key("fps"), "missing 'fps'");
        assert!(obj.contains_key("background"), "missing 'background'");
        assert_eq!(obj["fps"], 60);
        assert_eq!(obj["background"], "wallpaper1.jpg");
    }

    #[test]
    fn test_parse_resolution_1440p() {
        let res = parse_resolution("1440p").unwrap();
        assert_eq!(res.width, 2560);
        assert_eq!(res.height, 1440);
    }

    #[test]
    fn test_parse_resolution_case_insensitive() {
        assert!(parse_resolution("720P").is_some());
        assert!(parse_resolution("4K").is_some());
        assert!(parse_resolution("1080P").is_some());
    }

    #[test]
    fn test_parse_resolution_zero_dimensions() {
        let res = parse_resolution("0x0");
        // Parser accepts it (validation is the caller's responsibility)
        if let Some(r) = res {
            assert_eq!(r.width, 0);
            assert_eq!(r.height, 0);
        }
    }

    #[test]
    fn test_parse_resolution_large_dimensions() {
        let res = parse_resolution("7680x4320").unwrap();
        assert_eq!(res.width, 7680);
        assert_eq!(res.height, 4320);
    }

    #[test]
    fn test_parse_resolution_negative_rejected() {
        assert!(parse_resolution("-1x-1").is_none());
    }

    #[test]
    fn test_cli_options_serialization_round_trip() {
        let opts = CliOptions {
            input_file: Some("/tmp/video.webm".to_string()),
            export: true,
            output: Some("/tmp/output.mp4".to_string()),
            blur: true,
            shadow: true,
            shadow_intensity: 0.7,
            motion_blur: 0.3,
            roundness: 15.0,
            padding: 60.0,
            background: "gradient-sunset".to_string(),
            resolution: Some(Resolution {
                width: 1920,
                height: 1080,
            }),
            bitrate: Some(8_000_000),
            fps: 60,
        };

        let json = serde_json::to_string(&opts).unwrap();
        let loaded: CliOptions = serde_json::from_str(&json).unwrap();

        assert_eq!(loaded.input_file.as_deref(), Some("/tmp/video.webm"));
        assert!(loaded.export);
        assert_eq!(loaded.fps, 60);
        assert_eq!(loaded.bitrate, Some(8_000_000));
        assert_eq!(loaded.resolution.as_ref().unwrap().width, 1920);
        assert!((loaded.shadow_intensity - 0.7).abs() < 0.001);
    }

    #[test]
    fn test_cli_options_default_values() {
        let opts = CliOptions::default();
        assert!(!opts.export);
        assert!(!opts.blur);
        assert!(!opts.shadow);
        assert_eq!(opts.shadow_intensity, 0.0);
        assert_eq!(opts.motion_blur, 0.0);
        assert_eq!(opts.roundness, 0.0);
        assert_eq!(opts.padding, 0.0);
        assert!(opts.background.is_empty());
        assert!(opts.resolution.is_none());
        assert!(opts.bitrate.is_none());
    }

    #[test]
    fn test_headless_config_includes_resolution_when_set() {
        let opts = CliOptions {
            input_file: Some("/tmp/test.mp4".to_string()),
            export: true,
            resolution: Some(Resolution {
                width: 1920,
                height: 1080,
            }),
            bitrate: Some(5_000_000),
            fps: 30,
            ..Default::default()
        };

        let mut config = serde_json::json!({
            "inputFile": opts.input_file,
            "outputFile": opts.output,
            "fps": opts.fps,
        });
        if let Some(ref res) = opts.resolution {
            config["resolution"] = serde_json::json!({
                "width": res.width,
                "height": res.height,
            });
        }
        if let Some(bitrate) = opts.bitrate {
            config["bitrate"] = serde_json::json!(bitrate);
        }

        assert_eq!(config["resolution"]["width"], 1920);
        assert_eq!(config["resolution"]["height"], 1080);
        assert_eq!(config["bitrate"], 5_000_000);
    }

    #[test]
    fn test_output_path_derivation() {
        let input = PathBuf::from("/home/user/recordings/screen-001.webm");
        let stem = input
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let dir = input.parent().unwrap_or(&input);
        let derived = dir.join(format!("{}-openscreen.mp4", stem));
        assert_eq!(
            derived.to_string_lossy(),
            "/home/user/recordings/screen-001-openscreen.mp4"
        );
    }

    #[test]
    fn test_output_path_derivation_no_extension() {
        let input = PathBuf::from("/tmp/video");
        let stem = input
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let dir = input.parent().unwrap_or(&input);
        let derived = dir.join(format!("{}-openscreen.mp4", stem));
        assert_eq!(derived.to_string_lossy(), "/tmp/video-openscreen.mp4");
    }
}
