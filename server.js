require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const YouTubeService = require('./services/youtube');
const FacebookService = require('./services/facebook');
const TikTokService = require('./services/tiktok');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed (MP4, WebM, MOV, AVI)'));
        }
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize services
const youtube = new YouTubeService();
const facebook = new FacebookService();
const tiktok = new TikTokService();

// Store upload progress in memory
const uploadProgress = {};

// ==================== AUTH ROUTES ====================

// Get auth URLs
app.get('/api/auth/urls', (req, res) => {
    res.json({
        youtube: youtube.getAuthUrl(),
        facebook: facebook.getAuthUrl(),
        tiktok: tiktok.getAuthUrl()
    });
});

// YouTube OAuth callback
app.get('/api/auth/youtube/callback', async (req, res) => {
    try {
        const { code } = req.query;
        await youtube.handleCallback(code);
        res.redirect('/?connected=youtube');
    } catch (err) {
        console.error('YouTube auth error:', err.message);
        res.redirect('/?error=youtube_auth_failed');
    }
});

// Facebook OAuth callback
app.get('/api/auth/facebook/callback', async (req, res) => {
    try {
        const { code } = req.query;
        await facebook.handleCallback(code);
        res.redirect('/?connected=facebook');
    } catch (err) {
        console.error('Facebook auth error:', err.message);
        res.redirect('/?error=facebook_auth_failed');
    }
});

// TikTok OAuth callback
app.get('/api/auth/tiktok/callback', async (req, res) => {
    try {
        const { code } = req.query;
        await tiktok.handleCallback(code);
        res.redirect('/?connected=tiktok');
    } catch (err) {
        console.error('TikTok auth error:', err.message);
        res.redirect('/?error=tiktok_auth_failed');
    }
});

// Disconnect platform
app.post('/api/auth/disconnect/:platform', (req, res) => {
    const { platform } = req.params;
    switch (platform) {
        case 'youtube': youtube.disconnect(); break;
        case 'facebook': facebook.disconnect(); break;
        case 'tiktok': tiktok.disconnect(); break;
    }
    res.json({ success: true, platform, connected: false });
});

// ==================== STATUS ROUTES ====================

app.get('/api/status', (req, res) => {
    res.json({
        platforms: {
            youtube: youtube.getStatus(),
            facebook: facebook.getStatus(),
            tiktok: tiktok.getStatus()
        },
        configured: {
            youtube: !!process.env.YOUTUBE_CLIENT_ID,
            facebook: !!process.env.FACEBOOK_APP_ID,
            tiktok: !!process.env.TIKTOK_CLIENT_KEY
        }
    });
});

app.get('/api/upload/progress/:id', (req, res) => {
    const { id } = req.params;
    res.json(uploadProgress[id] || { status: 'unknown' });
});

// ==================== UPLOAD ROUTES ====================

app.post('/api/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        const { title, description, tags, platforms: platformsStr, youtubePrivacy } = req.body;
        const platforms = JSON.parse(platformsStr || '[]');

        if (platforms.length === 0) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Please select at least one platform' });
        }

        const uploadId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const filePath = req.file.path;
        const metadata = { title, description, tags, youtubePrivacy };

        // Initialize progress
        uploadProgress[uploadId] = {
            status: 'uploading',
            platforms: {},
            startedAt: new Date().toISOString()
        };

        platforms.forEach(p => {
            uploadProgress[uploadId].platforms[p] = { status: 'pending', progress: 0 };
        });

        // Return upload ID immediately
        res.json({ uploadId, status: 'started', platforms });

        // Process uploads in background
        const uploadPromises = platforms.map(async (platform) => {
            try {
                uploadProgress[uploadId].platforms[platform].status = 'uploading';

                const onProgress = (progress) => {
                    uploadProgress[uploadId].platforms[platform].progress = progress;
                };

                let result;
                switch (platform) {
                    case 'youtube':
                        result = await youtube.uploadVideo(filePath, metadata, onProgress);
                        break;
                    case 'facebook':
                        result = await facebook.uploadVideo(filePath, metadata, onProgress);
                        break;
                    case 'tiktok':
                        result = await tiktok.uploadVideo(filePath, metadata, onProgress);
                        break;
                }

                uploadProgress[uploadId].platforms[platform] = {
                    status: 'completed',
                    progress: 100,
                    result
                };
            } catch (err) {
                console.error(`Upload to ${platform} failed:`, err.message);
                uploadProgress[uploadId].platforms[platform] = {
                    status: 'failed',
                    progress: 0,
                    error: err.message
                };
            }
        });

        await Promise.all(uploadPromises);

        // Check if all finished
        const allDone = Object.values(uploadProgress[uploadId].platforms)
            .every(p => p.status === 'completed' || p.status === 'failed');

        if (allDone) {
            uploadProgress[uploadId].status = 'completed';
            uploadProgress[uploadId].completedAt = new Date().toISOString();
        }

        // Clean up file after some delay
        setTimeout(() => {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        }, 60000);

    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`\n🚀 Multi-Platform Video Uploader is running!`);
    console.log(`📺 Open http://localhost:${PORT} in your browser\n`);
    console.log(`Platform Status:`);
    console.log(`  YouTube:  ${process.env.YOUTUBE_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`  Facebook: ${process.env.FACEBOOK_APP_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`  TikTok:   ${process.env.TIKTOK_CLIENT_KEY ? '✅ Configured' : '❌ Not configured'}\n`);
});

