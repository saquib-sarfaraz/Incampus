# InCampus - Campus Social Network

A modern, production-ready React social media application built for university campuses. Features real-time chat, stories, posts, comments, and friend requests.

## 🚀 Features

- **Authentication**: Secure JWT-based login and registration with reCAPTCHA protection
- **Feed**: Create posts with images, anonymous posting, likes, and comments
- **Stories**: Share temporary stories with images/videos
- **Chat**: Real-time messaging with WhatsApp-style UI
- **Profile**: Instagram-style grid layout for posts
- **Notifications**: Real-time activity notifications
- **Friend System**: Send and accept friend requests
- **Search**: Search users and posts
- **Mobile-First**: Fully responsive design with mobile navigation

## 🛠️ Tech Stack

- **React 18+** with Vite
- **React Router** for navigation
- **Tailwind CSS** for styling
- **Framer Motion** for animations
- **Socket.io Client** for real-time features
- **Context API** for state management
- **React Google reCAPTCHA** for bot protection

## 📦 Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (see `.env.example`):
```env
VITE_API_URL=https://incampusx-09ng.onrender.com
VITE_RECAPTCHA_SITE_KEY=your-recaptcha-site-key-here
```

3. Start the development server:
```bash
npm run dev
```

## 🏗️ Project Structure

```
src/
├── components/
│   ├── common/          # Header, BottomNav, ProtectedRoute
│   ├── feed/            # Post, PostCreator, CommentModal
│   ├── profile/         # PostModal
│   └── stories/         # StoryBar, StoryViewer
├── context/             # AuthContext, AppContext
├── pages/               # Login, Register, Feed, Chat, Profile
├── services/            # API service, Socket service
└── App.jsx              # Main app with routing
```

## 🔐 Authentication

- Login with username and password
- Registration requires email, password, full name, course, year, and student type
- JWT tokens stored in localStorage
- Protected routes require authentication
- Auto-login on page refresh if token exists

## 📱 Pages

### Login
- Glass morphism design
- Animated gradient background
- Password show/hide toggle
- Glow effect on button when fields are filled

### Register
- Multi-step form with animations
- Password strength indicator
- Email validation
- reCAPTCHA verification
- Auto-login after registration

### Feed
- Stories bar at top
- Post creator with image upload
- Anonymous posting option
- Real-time likes and comments
- Search functionality

### Chat
- WhatsApp-style interface
- Desktop: Sidebar + Chat panel
- Mobile: Slide-in chat panel
- Message grouping by date
- Real-time messaging via Socket.io

### Profile
- Instagram-style post grid
- Profile picture upload/delete
- Display name editing
- Post count and friend count
- Click post to view in modal

## 🎨 Styling

- Tailwind CSS with custom Gen Z color palette
- Glass morphism effects
- Smooth animations with Framer Motion
- Mobile-responsive design
- Dark mode ready (can be extended)

## 🔌 API Integration

All API calls are centralized in `src/services/api.js`:
- Auth endpoints (login, register)
- User endpoints (profile, search)
- Post endpoints (create, like, comment, delete)
- Story endpoints (create, fetch, delete)
- Chat endpoints (messages)
- Friend request endpoints
- Notification endpoints

## 📡 Socket.io

Real-time features:
- Chat messages
- Notifications
- Connection managed in `src/services/socket.js`

## 🚀 Deployment

Build for production:
```bash
npm run build
```

The `dist` folder contains the production build ready to deploy.

## 📝 Notes

- Test users: user1 to user1000
- Backend API URL can be configured via environment variable
- reCAPTCHA site key required for registration
- All features from original vanilla JS version preserved

## 🐛 Troubleshooting

- **Socket connection issues**: Check API URL and CORS settings
- **reCAPTCHA errors**: Verify site key in `.env`
- **Image upload fails**: Check file size limits and backend configuration
- **Authentication errors**: Clear localStorage and re-login

## 📄 License

MIT
