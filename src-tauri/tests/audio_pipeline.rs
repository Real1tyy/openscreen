mod common;

use common::*;
use openscreen::audio_muxer::mux_audio_into_video;

// ─── No regions (passthrough) ───────────────────────────────────

#[test]
fn passthrough_preserves_both_tracks() {
    let source = TempFile::new("ap_passthrough_src.mp4");
    let video = TempFile::new("ap_passthrough_vid.mp4");
    let output = TempFile::new("ap_passthrough_out.mp4");

    SourceMp4::default().with_duration(3.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s @ 10fps

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_valid_mp4(output.path());
    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
    assert_duration_approx(output.path(), 3.0, 1.0);
}

// ─── No-audio source just renames ───────────────────────────────

#[test]
fn no_audio_source_renames_to_output() {
    let video = TempFile::new("ap_noaudio_vid.mp4");
    let output = TempFile::new("ap_noaudio_out.mp4");

    VideoOnlyMp4::default().with_frames(10).build(video.path());

    // Use the video-only file as "source" — it has no audio
    mux_audio_into_video(
        video.path(),
        &video.path().to_string_lossy(),
        &[],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_valid_mp4(output.path());
    assert_has_video(output.path());
    assert_no_audio(output.path());
}

// ─── Trim: remove second half ───────────────────────────────────

#[test]
fn trim_second_half_keeps_audio() {
    let source = TempFile::new("ap_trim_half_src.mp4");
    let video = TempFile::new("ap_trim_half_vid.mp4");
    let output = TempFile::new("ap_trim_half_out.mp4");

    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s kept

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(3000.0, 6000.0)],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Trim: remove first half ────────────────────────────────────

#[test]
fn trim_first_half_keeps_audio() {
    let source = TempFile::new("ap_trim_first_src.mp4");
    let video = TempFile::new("ap_trim_first_vid.mp4");
    let output = TempFile::new("ap_trim_first_out.mp4");

    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path());

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(0.0, 3000.0)],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
}

// ─── Multiple trims: keep middle section ────────────────────────

#[test]
fn multiple_trims_keep_middle() {
    let source = TempFile::new("ap_multitrims_src.mp4");
    let video = TempFile::new("ap_multitrims_vid.mp4");
    let output = TempFile::new("ap_multitrims_out.mp4");

    SourceMp4::default().with_duration(9.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s kept

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(0.0, 3000.0), trim(6000.0, 9000.0)],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Speed 2x ───────────────────────────────────────────────────

#[test]
fn speed_2x_produces_audio() {
    let source = TempFile::new("ap_speed2x_src.mp4");
    let video = TempFile::new("ap_speed2x_vid.mp4");
    let output = TempFile::new("ap_speed2x_out.mp4");

    SourceMp4::default().with_duration(4.0).build(source.path());
    VideoOnlyMp4::default().with_frames(20).build(video.path()); // 2s @ 10fps

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[speed(0.0, 4000.0, 2.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Trim + speed combined ──────────────────────────────────────

#[test]
fn trim_and_speed_combined() {
    let source = TempFile::new("ap_combined_src.mp4");
    let video = TempFile::new("ap_combined_vid.mp4");
    let output = TempFile::new("ap_combined_out.mp4");

    // 6s source: trim 0-3s, speed 3-6s at 2x → 1.5s output
    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(15).build(video.path());

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(0.0, 3000.0)],
        &[speed(3000.0, 6000.0, 2.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Speed inside trim has zero effect ──────────────────────────

#[test]
fn speed_inside_trim_is_noop() {
    let source = TempFile::new("ap_speed_in_trim_src.mp4");
    let video = TempFile::new("ap_speed_in_trim_vid.mp4");
    let output = TempFile::new("ap_speed_in_trim_out.mp4");

    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s kept

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(3000.0, 6000.0)],
        &[speed(4000.0, 5000.0, 10.0)], // inside trim
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
}

// ─── Output is fully playable ───────────────────────────────────

#[test]
fn output_is_playable_mp4() {
    let source = TempFile::new("ap_playable_src.mp4");
    let video = TempFile::new("ap_playable_vid.mp4");
    let output = TempFile::new("ap_playable_out.mp4");

    SourceMp4::default()
        .with_duration(3.0)
        .with_resolution(320, 240)
        .with_fps(15)
        .build(source.path());
    VideoOnlyMp4::default()
        .with_resolution(320, 240)
        .with_fps(15)
        .with_frames(45)
        .build(video.path());

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_valid_mp4(output.path());
    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Regression: user's exact scenario ──────────────────────────

#[test]
fn user_scenario_trim_then_4x_speed() {
    let source = TempFile::new("ap_user_src.mp4");
    let video = TempFile::new("ap_user_vid.mp4");
    let output = TempFile::new("ap_user_out.mp4");

    // Scaled-down version: 6s → keep 0-3s → 4x speed → 0.75s
    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(8).build(video.path()); // ~0.8s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(3000.0, 6000.0)],
        &[speed(0.0, 3000.0, 4.0)],
        output.path(),
    )
    .expect("CRITICAL: user scenario mux failed");

    assert_valid_mp4(output.path());
    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}
