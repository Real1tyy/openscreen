mod common;

use common::*;
use openscreen::commands::export::ExportState;
use openscreen::encoder::{EncoderConfig, NvencEncoder};
use std::collections::HashMap;
use std::sync::Mutex;

fn make_state() -> Mutex<ExportState> {
    Mutex::new(ExportState::default())
}

fn insert_encoder(state: &Mutex<ExportState>, id: &str, path: &std::path::Path) -> NvencEncoder {
    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 10,
        bitrate: 500_000,
        output_path: path.to_string_lossy().to_string(),
    };
    let enc = NvencEncoder::new(&config).unwrap();
    enc
}

// ─── Session lifecycle: create → feed → finalize ────────────────

#[test]
fn full_session_lifecycle() {
    let state = make_state();
    let out = TempFile::new("es_lifecycle.mp4");

    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut encoder = NvencEncoder::new(&config).unwrap();
    let session_id = "test-session".to_string();

    state
        .lock()
        .unwrap()
        .sessions
        .insert(session_id.clone(), encoder);

    // Feed frames via state
    let rgba = vec![128u8; 320 * 240 * 4];
    for i in 0..15 {
        // Simulate feed_frame command
        let frame_file = TempFile::new(&format!("es_frame_{}.raw", i));
        std::fs::write(frame_file.path(), &rgba).unwrap();
        let data = std::fs::read(frame_file.path()).unwrap();

        let mut s = state.lock().unwrap();
        let enc = s.sessions.get_mut(&session_id).unwrap();
        enc.encode_rgba_frame(&data, 320, 240, i % 15 == 0).unwrap();
    }

    // Finalize
    let encoder = state.lock().unwrap().sessions.remove(&session_id).unwrap();
    assert_eq!(encoder.frame_count(), 15);
    let result_path = encoder.finalize().unwrap();

    assert!(result_path.exists());
    assert_valid_mp4(&result_path);

    let header = std::fs::read(&result_path).unwrap();
    assert_eq!(std::str::from_utf8(&header[4..8]).unwrap_or(""), "ftyp");
}

// ─── Cancel removes session ─────────────────────────────────────

#[test]
fn cancel_removes_session() {
    let state = make_state();
    let out = TempFile::new("es_cancel.mp4");

    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 10,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let encoder = NvencEncoder::new(&config).unwrap();
    let id = "cancel-me".to_string();

    state.lock().unwrap().sessions.insert(id.clone(), encoder);
    assert!(state.lock().unwrap().sessions.contains_key(&id));

    state.lock().unwrap().sessions.remove(&id);
    assert!(!state.lock().unwrap().sessions.contains_key(&id));
}

// ─── Multiple concurrent sessions ───────────────────────────────

#[test]
fn multiple_concurrent_sessions() {
    let state = make_state();
    let outs: Vec<TempFile> = (0..3)
        .map(|i| TempFile::new(&format!("es_concurrent_{}.mp4", i)))
        .collect();
    let ids: Vec<String> = (0..3).map(|i| format!("session-{}", i)).collect();

    // Create all sessions
    for (i, out) in outs.iter().enumerate() {
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: out.path().to_string_lossy().to_string(),
        };
        let encoder = NvencEncoder::new(&config).unwrap();
        state
            .lock()
            .unwrap()
            .sessions
            .insert(ids[i].clone(), encoder);
    }

    assert_eq!(state.lock().unwrap().sessions.len(), 3);

    // Feed frames to each
    let rgba = vec![128u8; 160 * 120 * 4];
    for id in &ids {
        let mut s = state.lock().unwrap();
        let enc = s.sessions.get_mut(id).unwrap();
        for i in 0..5 {
            enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
        }
    }

    // Finalize all
    for id in &ids {
        let enc = state.lock().unwrap().sessions.remove(id).unwrap();
        assert_eq!(enc.frame_count(), 5);
        let path = enc.finalize().unwrap();
        assert!(path.exists());
        assert_valid_mp4(&path);
    }

    assert_eq!(state.lock().unwrap().sessions.len(), 0);
}

// ─── Interleaved feeding between sessions ───────────────────────

#[test]
fn interleaved_feeding() {
    let state = make_state();
    let out_a = TempFile::new("es_interleave_a.mp4");
    let out_b = TempFile::new("es_interleave_b.mp4");

    for (id, out) in [("a", &out_a), ("b", &out_b)] {
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: out.path().to_string_lossy().to_string(),
        };
        let enc = NvencEncoder::new(&config).unwrap();
        state.lock().unwrap().sessions.insert(id.to_string(), enc);
    }

    let rgba = vec![128u8; 160 * 120 * 4];
    for frame in 0..10 {
        let id = if frame % 2 == 0 { "a" } else { "b" };
        let mut s = state.lock().unwrap();
        let enc = s.sessions.get_mut(id).unwrap();
        enc.encode_rgba_frame(&rgba, 160, 120, frame < 2).unwrap();
    }

    for id in ["a", "b"] {
        let enc = state.lock().unwrap().sessions.remove(id).unwrap();
        assert_eq!(enc.frame_count(), 5);
        enc.finalize().unwrap();
    }
}

// ─── Invalid session ID returns None ────────────────────────────

#[test]
fn invalid_session_id_returns_none() {
    let state = make_state();
    let result = state.lock().unwrap().sessions.remove("nonexistent");
    assert!(result.is_none());
}

// ─── Feed wrong-size frame to session fails ─────────────────────

#[test]
fn feed_wrong_size_to_session() {
    let state = make_state();
    let out = TempFile::new("es_wrongsize.mp4");

    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let encoder = NvencEncoder::new(&config).unwrap();
    state
        .lock()
        .unwrap()
        .sessions
        .insert("bad".to_string(), encoder);

    let wrong_data = vec![0u8; 100 * 100 * 4]; // wrong size
    let mut s = state.lock().unwrap();
    let enc = s.sessions.get_mut("bad").unwrap();
    let result = enc.encode_rgba_frame(&wrong_data, 320, 240, true);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("size mismatch"));
}
