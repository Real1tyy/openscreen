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

// ─── Slow speed (0.5x) ──────────────────────────────────────────

#[test]
fn slow_speed_half_produces_audio() {
    let source = TempFile::new("ap_slow_src.mp4");
    let video = TempFile::new("ap_slow_vid.mp4");
    let output = TempFile::new("ap_slow_out.mp4");

    // 2s at 0.5x → 4s output
    SourceMp4::default().with_duration(2.0).build(source.path());
    VideoOnlyMp4::default().with_frames(40).build(video.path()); // 4s @ 10fps

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[speed(0.0, 2000.0, 0.5)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Multiple non-adjacent speed regions ────────────────────────

#[test]
fn multiple_speed_regions() {
    let source = TempFile::new("ap_multispeed_src.mp4");
    let video = TempFile::new("ap_multispeed_vid.mp4");
    let output = TempFile::new("ap_multispeed_out.mp4");

    // 9s source: 0-3s at 2x (1.5s), 3-6s normal (3s), 6-9s at 3x (1s) → 5.5s
    SourceMp4::default().with_duration(9.0).build(source.path());
    VideoOnlyMp4::default().with_frames(55).build(video.path()); // ~5.5s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[speed(0.0, 3000.0, 2.0), speed(6000.0, 9000.0, 3.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_valid_mp4(output.path());
    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Speed partially overlapping trim boundary ─────────────────

#[test]
fn speed_overlaps_trim_boundary() {
    let source = TempFile::new("ap_overlap_src.mp4");
    let video = TempFile::new("ap_overlap_vid.mp4");
    let output = TempFile::new("ap_overlap_out.mp4");

    // 8s source. Trim 3-5s. Speed 2-6s at 2x.
    // Kept: 0-3s, 5-8s. Speed affects 2-3s (in kept) and 5-6s (in kept).
    SourceMp4::default().with_duration(8.0).build(source.path());
    VideoOnlyMp4::default().with_frames(45).build(video.path());

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(3000.0, 5000.0)],
        &[speed(2000.0, 6000.0, 2.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
    assert_decodable(output.path());
}

// ─── Adjacent trims (back to back) ─────────────────────────────

#[test]
fn adjacent_trims() {
    let source = TempFile::new("ap_adjacent_src.mp4");
    let video = TempFile::new("ap_adjacent_vid.mp4");
    let output = TempFile::new("ap_adjacent_out.mp4");

    // 9s source, trims 0-3s and 3-6s → keep only 6-9s
    SourceMp4::default().with_duration(9.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(0.0, 3000.0), trim(3000.0, 6000.0)],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_has_video(output.path());
    assert_has_audio(output.path());
}

// ─── Very short source (<1s) ────────────────────────────────────

#[test]
fn very_short_source() {
    let source = TempFile::new("ap_short_src.mp4");
    let video = TempFile::new("ap_short_vid.mp4");
    let output = TempFile::new("ap_short_out.mp4");

    SourceMp4::default().with_duration(0.5).build(source.path());
    VideoOnlyMp4::default().with_frames(5).build(video.path());

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
}

// ─── Higher resolution (640x480) ────────────────────────────────

#[test]
fn higher_resolution_source() {
    let source = TempFile::new("ap_hires_src.mp4");
    let video = TempFile::new("ap_hires_vid.mp4");
    let output = TempFile::new("ap_hires_out.mp4");

    SourceMp4::default()
        .with_resolution(640, 480)
        .with_fps(30)
        .with_duration(2.0)
        .build(source.path());
    VideoOnlyMp4::default()
        .with_resolution(640, 480)
        .with_fps(30)
        .with_frames(60)
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

// ─── Nonexistent source fails gracefully ────────────────────────

#[test]
fn nonexistent_source_fails_or_renames() {
    let video = TempFile::new("ap_noexist_vid.mp4");
    let output = TempFile::new("ap_noexist_out.mp4");

    VideoOnlyMp4::default().with_frames(5).build(video.path());

    let result = mux_audio_into_video(
        video.path(),
        "/nonexistent/path/source.mp4",
        &[],
        &[],
        output.path(),
    );

    // source_has_audio returns false for nonexistent → tries rename → succeeds
    assert!(result.is_ok());
    assert_valid_mp4(output.path());
}

// ─── DURATION INVARIANT TESTS ───────────────────────────────────
// These verify the output audio duration matches the expected
// timeline after trim/speed adjustments.

#[test]
fn duration_passthrough_matches_source() {
    let source = TempFile::new("ap_dur_pass_src.mp4");
    let video = TempFile::new("ap_dur_pass_vid.mp4");
    let output = TempFile::new("ap_dur_pass_out.mp4");

    SourceMp4::default().with_duration(4.0).build(source.path());
    VideoOnlyMp4::default().with_frames(40).build(video.path()); // 4s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_audio_duration_approx(output.path(), 4.0, 1.5);
}

#[test]
fn duration_2x_speed_halves_audio() {
    let source = TempFile::new("ap_dur_2x_src.mp4");
    let video = TempFile::new("ap_dur_2x_vid.mp4");
    let output = TempFile::new("ap_dur_2x_out.mp4");

    // 6s source at 2x → 3s output
    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[speed(0.0, 6000.0, 2.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_audio(output.path());
    assert_audio_duration_approx(output.path(), 3.0, 1.5);
}

#[test]
fn duration_4x_speed_quarters_audio() {
    let source = TempFile::new("ap_dur_4x_src.mp4");
    let video = TempFile::new("ap_dur_4x_vid.mp4");
    let output = TempFile::new("ap_dur_4x_out.mp4");

    // 8s source at 4x → 2s output
    SourceMp4::default().with_duration(8.0).build(source.path());
    VideoOnlyMp4::default().with_frames(20).build(video.path()); // 2s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[],
        &[speed(0.0, 8000.0, 4.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_audio(output.path());
    assert_audio_duration_approx(output.path(), 2.0, 1.5);
}

#[test]
fn duration_trim_removes_exact_amount() {
    let source = TempFile::new("ap_dur_trim_src.mp4");
    let video = TempFile::new("ap_dur_trim_vid.mp4");
    let output = TempFile::new("ap_dur_trim_out.mp4");

    // 6s source, trim 3-6s → 3s output
    SourceMp4::default().with_duration(6.0).build(source.path());
    VideoOnlyMp4::default().with_frames(30).build(video.path()); // 3s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(3000.0, 6000.0)],
        &[],
        output.path(),
    )
    .expect("mux failed");

    assert_has_audio(output.path());
    assert_audio_duration_approx(output.path(), 3.0, 1.5);
}

#[test]
fn duration_trim_plus_2x_speed() {
    let source = TempFile::new("ap_dur_combo_src.mp4");
    let video = TempFile::new("ap_dur_combo_vid.mp4");
    let output = TempFile::new("ap_dur_combo_out.mp4");

    // 8s source: trim 0-4s, speed 4-8s at 2x → 2s output
    SourceMp4::default().with_duration(8.0).build(source.path());
    VideoOnlyMp4::default().with_frames(20).build(video.path()); // 2s

    mux_audio_into_video(
        video.path(),
        &source.path().to_string_lossy(),
        &[trim(0.0, 4000.0)],
        &[speed(4000.0, 8000.0, 2.0)],
        output.path(),
    )
    .expect("mux failed");

    assert_has_audio(output.path());
    assert_audio_duration_approx(output.path(), 2.0, 1.5);
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
    assert_audio_duration_approx(output.path(), 0.75, 1.0);
}
