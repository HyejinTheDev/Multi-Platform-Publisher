const axios = require('axios');
const fs = require('fs');
const path = require('path');

class TikTokService {
    constructor() {
        this.clientKey = process.env.TIKTOK_CLIENT_KEY;
        this.clientSecret = process.env.TIKTOK_CLIENT_SECRET;
        this.redirectUri = process.env.TIKTOK_REDIRECT_URI;
        this.accessToken = null;
        this.openId = null;
        this.userInfo = null;
    }

    getAuthUrl() {
        const csrfState = Math.random().toString(36).substring(2);
        const scopes = 'user.info.basic,video.publish,video.upload';
        return `https://www.tiktok.com/v2/auth/authorize/?client_key=${this.clientKey}&scope=${scopes}&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}&state=${csrfState}`;
    }

    async handleCallback(code) {
        // Exchange code for access token
        const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
            client_key: this.clientKey,
            client_secret: this.clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: this.redirectUri
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        this.accessToken = tokenRes.data.access_token;
        this.openId = tokenRes.data.open_id;

        // Get user info
        try {
            const userRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                },
                params: {
                    fields: 'open_id,display_name,avatar_url'
                }
            });

            this.userInfo = userRes.data.data?.user;
        } catch (e) {
            this.userInfo = { display_name: 'TikTok User' };
        }

        return {
            platform: 'tiktok',
            connected: true,
            user: {
                name: this.userInfo?.display_name || 'TikTok User',
                picture: this.userInfo?.avatar_url
            }
        };
    }

    isConnected() {
        return !!this.accessToken;
    }

    getStatus() {
        return {
            platform: 'tiktok',
            connected: this.isConnected()
        };
    }

    async uploadVideo(filePath, metadata, onProgress) {
        if (!this.isConnected()) {
            throw new Error('TikTok is not connected. Please authenticate first.');
        }

        const fileSize = fs.statSync(filePath).size;

        // Step 1: Initialize video upload
        const initRes = await axios.post(
            'https://open.tiktokapis.com/v2/post/publish/video/init/',
            {
                post_info: {
                    title: metadata.title || 'Untitled Video',
                    privacy_level: 'SELF_ONLY',
                    disable_duet: false,
                    disable_comment: false,
                    disable_stitch: false
                },
                source_info: {
                    source: 'FILE_UPLOAD',
                    video_size: fileSize,
                    chunk_size: fileSize,
                    total_chunk_count: 1
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8'
                }
            }
        );

        const publishId = initRes.data.data?.publish_id;
        const uploadUrl = initRes.data.data?.upload_url;

        if (!uploadUrl) {
            throw new Error('Failed to get TikTok upload URL');
        }

        // Step 2: Upload the video file
        const videoData = fs.readFileSync(filePath);
        await axios.put(uploadUrl, videoData, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
                'Content-Length': fileSize
            },
            onUploadProgress: (progressEvent) => {
                const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                if (onProgress) onProgress(progress);
            }
        });

        return {
            platform: 'tiktok',
            success: true,
            publishId: publishId,
            url: `https://www.tiktok.com`
        };
    }

    disconnect() {
        this.accessToken = null;
        this.openId = null;
        this.userInfo = null;
    }
}

module.exports = TikTokService;
