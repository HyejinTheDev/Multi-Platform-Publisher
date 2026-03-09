const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class YouTubeService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );
    this.tokens = null;
  }

  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      prompt: 'consent'
    });
  }

  async handleCallback(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this.tokens = tokens;

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const { data } = await oauth2.userinfo.get();

    return {
      platform: 'youtube',
      connected: true,
      user: {
        name: data.name,
        picture: data.picture
      }
    };
  }

  isConnected() {
    return !!this.tokens;
  }

  getStatus() {
    return {
      platform: 'youtube',
      connected: this.isConnected()
    };
  }

  async uploadVideo(filePath, metadata, onProgress) {
    if (!this.isConnected()) {
      throw new Error('YouTube is not connected. Please authenticate first.');
    }

    this.oauth2Client.setCredentials(this.tokens);
    const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });

    const fileSize = fs.statSync(filePath).size;

    const res = await youtube.videos.insert(
      {
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title: metadata.title || 'Untitled Video',
            description: metadata.description || '',
            tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()) : [],
            categoryId: '22' // People & Blogs
          },
          status: {
            privacyStatus: metadata.youtubePrivacy || 'public',
            selfDeclaredMadeForKids: false
          }
        },
        media: {
          body: fs.createReadStream(filePath)
        }
      },
      {
        onUploadProgress: (evt) => {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          if (onProgress) onProgress(progress);
        }
      }
    );

    return {
      platform: 'youtube',
      success: true,
      videoId: res.data.id,
      url: `https://www.youtube.com/watch?v=${res.data.id}`
    };
  }

  disconnect() {
    this.tokens = null;
    this.oauth2Client.revokeCredentials();
  }
}

module.exports = YouTubeService;
