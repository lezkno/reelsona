export interface VideoPreviewSourceInput {
  status?: string | null
  video_url?: string | null
  captioned_video_url?: string | null
}

export interface VideoPreviewSources {
  videoSrc: string | null
  fallbackSrc: string | null
  showsOriginal: boolean
}

/**
 * A cancelled post-production job must expose the provider's original video,
 * never a partial or stale effect render left by the cancelled worker.
 */
export function resolveVideoPreviewSources(
  video: VideoPreviewSourceInput | null | undefined,
): VideoPreviewSources {
  if (!video) {
    return { videoSrc: null, fallbackSrc: null, showsOriginal: false }
  }

  if (video.status === "cancelled") {
    return {
      videoSrc: video.video_url ?? null,
      fallbackSrc: null,
      showsOriginal: true,
    }
  }

  return {
    videoSrc: video.captioned_video_url ?? null,
    fallbackSrc: video.video_url ?? null,
    showsOriginal: false,
  }
}