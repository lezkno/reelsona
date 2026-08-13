CREATE TABLE "instagram_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text NOT NULL,
	"name" text,
	"profile_picture_url" text,
	"followers_count" integer DEFAULT 0 NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp,
	"needs_reconnection" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_accounts_ig_user_id_unique" UNIQUE("ig_user_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"niche" text DEFAULT '' NOT NULL,
	"niche_description" text,
	"topic_keywords" text[] DEFAULT '{}' NOT NULL,
	"tone" text DEFAULT 'casual' NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"video_duration_seconds" integer DEFAULT 60 NOT NULL,
	"include_captions" boolean DEFAULT true NOT NULL,
	"watermark_text" text,
	"heygen_api_key" text,
	"heygen_voice_speed" real,
	"welcome_dismissed" boolean DEFAULT false NOT NULL,
	"video_effects" jsonb DEFAULT '{"zoom":false,"ai_broll":false,"text_cards":false}'::jsonb NOT NULL,
	"brand_logo_url" text,
	"brand_primary_color" text,
	"brand_accent_color" text,
	"brand_palette_colors" text[],
	"openai_api_key" text,
	"offer" text,
	"ideal_audience" text,
	"unique_value_prop" text,
	"voice_style" text,
	"common_objections" text,
	"custom_cta" text
);
--> statement-breakpoint
CREATE TABLE "avatar_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"selected_avatar_ids" text[] DEFAULT '{}' NOT NULL,
	"preferred_voice_id" text,
	"voice_overrides" json DEFAULT '{}'::json NOT NULL,
	"rotation_strategy" text DEFAULT 'sequential' NOT NULL,
	"last_used_avatar_id" text,
	"avatar_usage_count" json DEFAULT '{}'::json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"topic" text NOT NULL,
	"hook" text,
	"script" text,
	"cta" text,
	"avatar_id" text,
	"voice_id" text,
	"caption" text,
	"hashtags" text,
	"scheduled_at" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"video_id" integer,
	"copy_status" text,
	"viral_score" integer,
	"editorial_angle" text,
	"hook_candidates" text,
	"hook_selection_reason" text,
	"share_reason" text,
	"audience_pain" text,
	"novelty_level" text,
	"visual_dependency" text,
	"format_fit_score" real,
	"suggested_visual_support" text,
	"avatar_fit_reason" text,
	"video_effects_override" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"content_plan_id" integer,
	"heygen_video_id" text,
	"topic" text,
	"avatar_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"video_url" text,
	"thumbnail_url" text,
	"ig_media_id" text,
	"ig_permalink" text,
	"error_message" text,
	"duration_seconds" integer,
	"published_at" timestamp,
	"scheduled_publish_at" timestamp,
	"captioned_video_url" text,
	"caption_status" text DEFAULT 'disabled',
	"poll_attempts" integer DEFAULT 0 NOT NULL,
	"generating_started_at" timestamp,
	"ig_container_id" text,
	"video_effects" jsonb,
	"heygen_subtitle_url" text,
	"thumbnail_cover_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"posting_times" text[] DEFAULT '{"09:00","18:00"}' NOT NULL,
	"days_of_week" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"timezone" text DEFAULT 'America/Buenos_Aires' NOT NULL,
	"auto_generate_script" boolean DEFAULT true NOT NULL,
	"auto_generate_video" boolean DEFAULT true NOT NULL,
	"auto_publish" boolean DEFAULT true NOT NULL,
	"captions_enabled" boolean DEFAULT false NOT NULL,
	"auto_cover_enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_run_status" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caption_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"preset_id" text DEFAULT 'viral' NOT NULL,
	"position" text DEFAULT 'bottom' NOT NULL,
	"words_per_line" integer DEFAULT 3 NOT NULL,
	"primary_color" text DEFAULT '#FFFFFF' NOT NULL,
	"active_word_color" text DEFAULT '#FFE600' NOT NULL,
	"outline_color" text DEFAULT '#000000' NOT NULL,
	"background_color" text,
	"font_family" text DEFAULT 'Oswald' NOT NULL,
	"font_size" integer DEFAULT 88 NOT NULL,
	"active_word_scale" real DEFAULT 1.2 NOT NULL,
	"highlight_mode" text DEFAULT 'color' NOT NULL,
	"auto_scale" boolean DEFAULT true NOT NULL,
	"line_spacing_factor" real DEFAULT 1.1 NOT NULL,
	"y_position" real DEFAULT 75 NOT NULL,
	"margin_x" real DEFAULT 60 NOT NULL,
	"auto_movement" boolean DEFAULT false NOT NULL,
	"subtle_rotation" boolean DEFAULT false NOT NULL,
	"caption_engine" text DEFAULT 'standard' NOT NULL,
	"template_id" text,
	"template_overrides" text,
	"selected_preset_ids" text[] DEFAULT '{}' NOT NULL,
	"caption_rotation_strategy" text DEFAULT 'sequential' NOT NULL,
	"last_used_preset_id" text,
	"preset_usage_count" json DEFAULT '{}'::json NOT NULL,
	"card_template" json,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" varchar(128),
	"email" varchar(256),
	"phone" varchar(32),
	"role" varchar(32) DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"avatar_url" text,
	"last_login_at" timestamp,
	"verification_token" text,
	"verification_token_expires_at" timestamp,
	"activation_token" text,
	"activation_token_expires_at" timestamp,
	"password_reset_token" text,
	"password_reset_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "instagram_audit_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"recommended_topics" text[] DEFAULT '{}' NOT NULL,
	"content_insights" text,
	"top_captions_json" text DEFAULT '[]' NOT NULL,
	"avg_engagement" real DEFAULT 0 NOT NULL,
	"best_posting_times" text[] DEFAULT '{}' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_data" jsonb,
	"market_insights" jsonb,
	"content_strategy" jsonb,
	"steps_completed" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niche_radar_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ig_username" text NOT NULL,
	"profile_url" text,
	"bio" text,
	"followers" integer,
	"relevance_score" integer DEFAULT 5,
	"use_as_reference" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"top_posts_json" jsonb,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"lesson_id" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"course_access" boolean DEFAULT false NOT NULL,
	"tool_access_status" varchar(16) DEFAULT 'disabled' NOT NULL,
	"tool_access_starts_at" timestamp,
	"tool_access_ends_at" timestamp,
	"source" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_entitlements_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(32) DEFAULT 'stripe' NOT NULL,
	"provider_session_id" varchar(256) NOT NULL,
	"provider_customer_id" varchar(256),
	"email" varchar(256) NOT NULL,
	"full_name" varchar(256),
	"amount_total" integer,
	"currency" varchar(8),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"tool_access_days" integer DEFAULT 30 NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_provider_session_id_unique" UNIQUE("provider_session_id")
);
--> statement-breakpoint
CREATE TABLE "heygen_cloned_voices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"voice_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"speed" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "heygen_cloned_voices_voice_id_unique" UNIQUE("voice_id")
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatar_config" ADD CONSTRAINT "avatar_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_config" ADD CONSTRAINT "automation_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_config" ADD CONSTRAINT "caption_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heygen_cloned_voices" ADD CONSTRAINT "heygen_cloned_voices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;