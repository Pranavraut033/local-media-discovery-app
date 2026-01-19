# PIN Authentication Setup Guide

This application now includes PIN-based authentication with persistent sessions and user-scoped folders and interactions.

## Initial Setup

### 1. Initialize the Database

The database is automatically initialized when you first start the backend server:

```bash
cd backend
npm run dev
```

Wait for the server to start and see the message "Database schema initialized". You can then stop the server (Ctrl+C).

### 2. Create Your First User

After the database is initialized, create a user account:

```bash
cd backend
npm run create-user 123456
```

Replace `123456` with your desired 6-digit PIN.

The script will:
- Hash your 6-digit PIN securely using bcrypt
- Create a user account in the database
- Display the user ID

**Important:** Keep your PIN secure and memorize it. You'll need it to access the application.

### 3. Set JWT Secret (Optional but Recommended)

For production use, set a strong JWT secret:

```bash
export JWT_SECRET="your-very-secure-random-string-here"
```

Or add it to your environment variables file.

### 4. Start the Application

```bash
# Start backend
cd backend
npm run dev

# Start frontend (in another terminal)
cd frontend
npm run dev
```

## Using the Application

### First Launch

1. Open the application in your browser
2. You'll see a PIN login screen
3. Enter your 6-digit PIN
4. Click "Unlock" to authenticate

### Session Management

- **Long-lived sessions:** Your authentication token is stored in localStorage and valid for 30 days
- **Auto-logout:** You'll only need to re-login if:
  - You manually log out
  - The token expires (after 30 days)
  - You clear your browser data

### User-Scoped Features

After authentication, all features are scoped to your user account:

1. **Folders:** All indexed folders are associated with your account
2. **Interactions:** Likes, saves, hidden items, and view counts are personal to you
3. **Privacy:** Other users (if you create multiple accounts) cannot see your interactions

## Managing Multiple Users

### Create Additional Users

```bash
cd backend
npm run create-user <new-6-digit-pin>
```

### User Isolation

- Each user has their own:
  - Folder associations
  - Liked media list
  - Saved media list
  - Hidden media list
  - View history

## Security Notes

1. **PIN Format:** Must be exactly 6 numeric digits (0-9)
2. **PIN Storage:** PINs are hashed using bcrypt with 10 salt rounds
3. **JWT Tokens:** Stored in localStorage, valid for 30 days
4. **Token Transmission:** All API requests include the JWT token in the Authorization header

## Troubleshooting

### Forgot Your PIN?

If you forget your PIN, you'll need database access to reset it:

```bash
# Delete the database and start fresh
rm backend/media.db
npm run create-user <new-pin>
```

**Note:** This will delete all indexed media and interactions.

### Token Issues

If you experience authentication issues:

1. Clear browser localStorage
2. Refresh the page
3. Re-enter your PIN

### Migration from Previous Version

If you're upgrading from a version without authentication:

1. The database migration will automatically create a "default-user" account
2. All existing folders and interactions will be associated with this default user
3. Create a new PIN for this user using the CLI script
4. The default user's placeholder PIN hash should be updated

## API Changes

### Protected Endpoints

All the following endpoints now require authentication (JWT token in Authorization header):

- `/api/feed` - Get media feed
- `/api/index` - Index folders
- `/api/sources` - Get user's folders
- `/api/like` - Like media (requires sourceId)
- `/api/save` - Save media (requires sourceId)
- `/api/view` - Record view (requires sourceId)
- `/api/hide` - Hide media (requires sourceId)
- `/api/saved` - Get saved media
- `/api/liked` - Get liked media
- `/api/hidden` - Get hidden media

### New Endpoints

- `POST /api/auth/login` - Authenticate with PIN
- `POST /api/auth/verify` - Verify JWT token
- `GET /api/auth/check-setup` - Check if users exist

### Request Body Changes

Interaction endpoints now require both `mediaId` and `sourceId`:

```json
{
  "mediaId": "abc123",
  "sourceId": "def456"
}
```

## Development

### JWT Secret for Development

The default JWT secret is `your-secret-key-change-this-in-production`. For local development, this is fine, but **always set a strong secret in production**.

### Testing Authentication

You can test the authentication flow using curl:

```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"pin":"123456"}'

# Use the returned token in subsequent requests
curl http://localhost:3001/api/feed \
  -H "Authorization: Bearer <your-token-here>"
```

## Architecture

### Database Schema

- **users:** Stores user accounts with hashed PINs
- **user_folders:** Links users to their folders
- **user_interactions:** Stores user-specific interactions (likes, saves, hidden, views) per folder

### Authentication Flow

1. User enters 6-digit PIN
2. Backend validates PIN against hashed value in database
3. Backend generates JWT token (valid 30 days)
4. Frontend stores token in localStorage
5. All API requests include token in Authorization header
6. Backend verifies token and extracts user ID
7. Operations are scoped to authenticated user

---

**For questions or issues, please refer to the main README.md or open an issue.**
