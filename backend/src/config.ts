/**
 * Application configuration
 */

interface ServerConfig {
  host: string;
  port: number;
}

interface SupportedMedia {
  images: string[];
  videos: string[];
}

interface ThumbnailConfig {
  width: number;
  height: number;
  quality: number;
}

interface AppConfig {
  server: ServerConfig;
  supportedMedia: SupportedMedia;
  thumbnails: ThumbnailConfig;
}

export const config: AppConfig = {
  // Server configuration
  server: {
    host: '0.0.0.0', // Bind to all interfaces for LAN access
    port: parseInt(process.env.PORT || '3001', 10),
  },

  // Supported media types
  supportedMedia: {
    images: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    videos: ['.mp4', '.webm', '.mov'],
  },

  // Thumbnail configuration
  thumbnails: {
    width: 400,
    height: 400,
    quality: 80,
  },
};
