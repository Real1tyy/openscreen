mod common;

use common::*;
use openscreen::commands::export::ExportState;
use openscreen::encoder::EncoderConfig;
use openscreen::pipeline::PipelinedEncoder;
use std::sync::Mutex;

fn make_state() -> Mutex<ExportState> {
    Mutex::new(ExportState::default())
}

fn make_pipeline(path: &std::path::Path, w: u32, h: u32) -> PipelinedEncoder {
    let config = EncoderConfig {
        width: w,
        height: h,
        fps: 30,
        bitrate: 1_000_000,
        output_path: path.to_string_lossy().to_string(),
    };
    PipelinedEncoder::new(config).unwrap()
}

fn make_rgba(w: u32, h: u32, seed: u8) -> Vec<u8> {
    let size = (w * h * 4) as usize;
    let mut rgba = vec![0u8; size];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[0] = seed;
        pixel[1] = 128;
        pixel[2] = 255u8.wrapping_sub(seed);
        pixel[3] = 255;
    }
    rgba
}

// ─── Session lifecycle: create → feed → finalize ────────────────

#[test]
fn full_session_lifecycle() {
    let state = make_state();
    let out = TempFile::new("es_lifecycle.mp4");

    let pipeline = make_pipeline(out.path(), 320, 240);
    let session_id = "test-session".to_string();

    state
        .lock()
        .unwrap()
        .sessions
        .insert(session_id.clone(), pipeline);

    let rgba = make_rgba(320, 240, 128);
    for i in 0..15 {
        let frame_file = TempFile::new(&format!("es_frame_{}.raw", i));
        std::fs::write(frame_file.path(), &rgba).unwrap();
        let data = std::fs::read(frame_file.path()).unwrap();

        let s = state.lock().unwrap();
        let p = s.sessions.get(&session_id).unwrap();
        p.send_frame(data, 320, 240, i % 15 == 0).unwrap();
    }

    let pipeline = state.lock().unwrap().sessions.remove(&session_id).unwrap();
    let result_path = pipeline.finalize().unwrap();

    assert!(result_path.exists());
    assert_valid_mp4(&result_path);
}

// ─── Cancel removes session ─────────────────────────────────────

#[test]
fn cancel_removes_session() {
    let state = make_state();
    let out = TempFile::new("es_cancel.mp4");

    let pipeline = make_pipeline(out.path(), 160, 120);
    let id = "cancel-me".to_string();

    state.lock().unwrap().sessions.insert(id.clone(), pipeline);
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

    for (i, out) in outs.iter().enumerate() {
        let pipeline = make_pipeline(out.path(), 160, 120);
        state
            .lock()
            .unwrap()
            .sessions
            .insert(ids[i].clone(), pipeline);
    }

    assert_eq!(state.lock().unwrap().sessions.len(), 3);

    let rgba = make_rgba(160, 120, 128);
    for id in &ids {
        let s = state.lock().unwrap();
        let p = s.sessions.get(id).unwrap();
        for i in 0..5 {
            p.send_frame(rgba.clone(), 160, 120, i == 0).unwrap();
        }
    }

    for id in &ids {
        let pipeline = state.lock().unwrap().sessions.remove(id).unwrap();
        let path = pipeline.finalize().unwrap();
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
        let pipeline = make_pipeline(out.path(), 160, 120);
        state
            .lock()
            .unwrap()
            .sessions
            .insert(id.to_string(), pipeline);
    }

    let rgba = make_rgba(160, 120, 128);
    for frame in 0..10 {
        let id = if frame % 2 == 0 { "a" } else { "b" };
        let s = state.lock().unwrap();
        let p = s.sessions.get(id).unwrap();
        p.send_frame(rgba.clone(), 160, 120, frame < 2).unwrap();
    }

    for id in ["a", "b"] {
        let pipeline = state.lock().unwrap().sessions.remove(id).unwrap();
        pipeline.finalize().unwrap();
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

    let pipeline = make_pipeline(out.path(), 320, 240);
    state
        .lock()
        .unwrap()
        .sessions
        .insert("bad".to_string(), pipeline);

    let wrong_data = vec![0u8; 100 * 100 * 4];

    let s = state.lock().unwrap();
    let p = s.sessions.get("bad").unwrap();
    p.send_frame(wrong_data, 320, 240, true).ok();
    drop(s);

    // Error is async — wait briefly for the encoder thread to process
    std::thread::sleep(std::time::Duration::from_millis(50));

    let s = state.lock().unwrap();
    let p = s.sessions.get("bad").unwrap();
    let result = p.send_frame(vec![0u8; 100], 320, 240, false);
    assert!(result.is_err());
}
