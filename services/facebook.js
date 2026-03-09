const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

class FacebookService {
    constructor() {
        this.appId = process.env.FACEBOOK_APP_ID;
        this.appSecret = process.env.FACEBOOK_APP_SECRET;
        this.redirectUri = process.env.FACEBOOK_REDIRECT_URI;
        this.userToken = null;
        this.pageToken = null;
        this.pageId = null;
        this.userInfo = null;
    }

    getAuthUrl() {
        const scopes = 'pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content';
        return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${this.appId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${scopes}&response_type=code`;
    }

    async handleCallback(code) {
        // Exchange code for access token
        const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
            params: {
                client_id: this.appId,
                client_secret: this.appSecret,
                redirect_uri: this.redirectUri,
                code: code
            }
        });

        this.userToken = tokenRes.data.access_token;

        // Get user info
        const userRes = await axios.get('https://graph.facebook.com/v19.0/me', {
            params: {
                access_token: this.userToken,
                fields: 'name,picture'
            }
        });

        this.userInfo = userRes.data;

        // Get pages managed by user
        const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
            params: {
                access_token: this.userToken
            }
        });

        if (pagesRes.data.data && pagesRes.data.data.length > 0) {
            const page = pagesRes.data.data[0];
            this.pageToken = page.access_token;
            this.pageId = page.id;
        }

        return {
            platform: 'facebook',
            connected: true,
            user: {
                name: this.userInfo.name,
                picture: this.userInfo.picture?.data?.url
            },
            pages: pagesRes.data.data?.map(p => ({ id: p.id, name: p.name })) || []
        };
    }

    isConnected() {
        return !!(this.userToken && this.pageToken);
    }

    getStatus() {
        return {
            platform: 'facebook',
            connected: this.isConnected()
        };
    }

    async uploadVideo(filePath, metadata, onProgress) {
        if (!this.isConnected()) {
            throw new Error('Facebook is not connected. Please authenticate first.');
        }

        const fileSize = fs.statSync(filePath).size;
        const fileName = path.basename(filePath);

        // Step 1: Start upload session
        const uploadSessionRes = await axios.post(
            `https://graph.facebook.com/v19.0/${this.appId}/uploads`,
            null,
            {
                params: {
                    file_name: fileName,
                    file_length: fileSize,
                    file_type: 'video/mp4',
                    access_token: this.userToken
                }
            }
        );

        const uploadSessionId = uploadSessionRes.data.id;

        // Step 2: Upload the file
        const fileData = fs.readFileSync(filePath);
        const uploadRes = await axios.post(
            `https://graph.facebook.com/v19.0/${uploadSessionId}`,
            fileData,
            {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'file_offset': '0'
                },
                params: {
                    access_token: this.userToken
                },
                onUploadProgress: (progressEvent) => {
                    const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                    if (onProgress) onProgress(progress);
                }
            }
        );

        const fileHandle = uploadRes.data.h;

        // Step 3: Publish to page
        const publishRes = await axios.post(
            `https://graph.facebook.com/v19.0/${this.pageId}/videos`,
            null,
            {
                params: {
                    access_token: this.pageToken,
                    title: metadata.title || 'Untitled Video',
                    description: metadata.description || '',
                    fbuploader_video_file_chunk: fileHandle
                }
            }
        );

        return {
            platform: 'facebook',
            success: true,
            videoId: publishRes.data.id,
            url: `https://www.facebook.com/${this.pageId}/videos/${publishRes.data.id}`
        };
    }

    disconnect() {
        this.userToken = null;
        this.pageToken = null;
        this.pageId = null;
        this.userInfo = null;
    }
}

module.exports = FacebookService;
