import axios from "axios";
import { logger } from "./logger";

const HEYGEN_BASE_URL = "https://api.heygen.com";

function getClient() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is not set");
  return axios.create({
    baseURL: HEYGEN_BASE_URL,
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
  });
}

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string | null;
  preview_video_url?: string | null;
  gender?: string | null;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language: string;
  gender?: string | null;
  preview_audio_url?: string | null;
  is_clone?: boolean;
}

export async function listAvatars(): Promise<HeyGenAvatar[]> {
  const client = getClient();
  const res = await client.get("/v2/avatars");
  const avatars: HeyGenAvatar[] = res.data?.data?.avatars ?? [];
  return avatars;
}

export interface HeyGenAvatarGroup {
  id: string;
  name: string;
  group_type: string;
  num_looks: number;
  preview_image: string | null;
}

export interface HeyGenGroupLook {
  id: string;
  name: string;
  image_url: string | null;
  motion_preview_url?: string | null;
}

export async function listAvatarGroups(): Promise<HeyGenAvatarGroup[]> {
  const client = getClient();
  const res = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
  return res.data?.data?.avatar_group_list ?? [];
}

export async function listGroupLooks(groupId: string): Promise<HeyGenGroupLook[]> {
  const client = getClient();
  const res = await client.get(`/v2/avatar_group/${groupId}/avatars`);
  return res.data?.data?.avatar_list ?? [];
}

export async function listVoices(): Promise<HeyGenVoice[]> {
  const client = getClient();
  const res = await client.get("/v2/voices");
  const voices: HeyGenVoice[] = res.data?.data?.voices ?? [];
  return voices;
}

export interface GenerateVideoParams {
  script: string;
  avatar_id: string;
  voice_id: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface VideoStatus {
  video_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  error?: string | null;
}

export async function generateVideo(params: GenerateVideoParams): Promise<string> {
  const client = getClient();
  const payload = {
    video_inputs: [
      {
        character: params.avatar_id.startsWith("tp:")
          ? {
              type: "talking_photo",
              talking_photo_id: params.avatar_id.slice(3),
            }
          : {
              type: "avatar",
              avatar_id: params.avatar_id,
              avatar_style: "normal",
            },
        voice: {
          type: "text",
          input_text: params.script,
          voice_id: params.voice_id,
        },
      },
    ],
    dimension: { width: params.width ?? 1080, height: params.height ?? 1920 },
    title: params.title ?? "ContentPilot Video",
    test: false,
  };

  const res = await client.post("/v2/video/generate", payload);
  const videoId: string = res.data?.data?.video_id;
  if (!videoId) throw new Error("HeyGen did not return a video_id");
  logger.info({ videoId }, "HeyGen video generation started");
  return videoId;
}

export async function getVideoStatus(videoId: string): Promise<VideoStatus> {
  const client = getClient();
  const res = await client.get("/v1/video_status.get", { params: { video_id: videoId } });
  const data = res.data?.data;
  return {
    video_id: videoId,
    status: mapStatus(data?.status),
    video_url: data?.video_url ?? null,
    thumbnail_url: data?.thumbnail_url ?? null,
    duration: data?.duration ?? null,
    error: data?.error ?? null,
  };
}

function mapStatus(s: string): VideoStatus["status"] {
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  if (s === "processing" || s === "pending") return s;
  return "pending";
}
