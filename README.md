# Debate Wiki

A React TypeScript application for managing and analyzing debate cards with Firebase authentication and Google Sign-in.

## Features

- **Firebase Authentication**: Secure Google Sign-in integration
- **Document Processing**: Upload and parse .docx files to extract debate cards
- **Advanced Search**: Powerful search engine with boolean logic, phrase matching, and fuzzy search
- **Smart Filtering**: Filter by document, section, year, and remove duplicates
- **Card Management**: Preview, copy, and download individual cards
- **Real-time Sync**: User data synced with Firebase Firestore
- **Responsive Design**: Works on desktop and mobile devices

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Firebase Configuration

1. Create a new Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication and Firestore Database
3. Enable Google Sign-in in Authentication > Sign-in method
4. Copy your Firebase config and update `src/firebase.ts`:

```typescript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

### 3. Firestore Security Rules

Add these rules to your Firestore database:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Public read access for shared cards (optional)
    match /cards/{cardId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
  }
}
```

### 4. Development

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### 5. Build for Production

```bash
npm run build
```

## Deployment

### Firebase Hosting

1. Install Firebase CLI:
```bash
npm install -g firebase-tools
```

2. Login and initialize:
```bash
firebase login
firebase init hosting
```

3. Deploy:
```bash
npm run build
firebase deploy
```

### Other Platforms

The built files in the `build` folder can be deployed to any static hosting service like:
- Vercel
- Netlify
- AWS S3 + CloudFront
- GitHub Pages

## Usage

1. **Sign In**: Use Google Sign-in to authenticate
2. **Upload Documents**: Click "Add documents" to upload .docx files
3. **Search & Filter**: Use the advanced search and filtering options
4. **Manage Cards**: Select cards to preview, copy, or download
5. **Organize**: Use year filters and deduplication to organize your research

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Authentication**: Firebase Auth with Google Sign-in
- **Database**: Firebase Firestore
- **File Processing**: JSZip for .docx parsing
- **Styling**: CSS Custom Properties (CSS Variables)
- **Build Tool**: Create React App

## File Structure

```
src/
├── components/          # React components
├── contexts/           # React contexts (Auth)
├── hooks/             # Custom React hooks
├── utils/             # Utility functions
├── types.ts           # TypeScript type definitions
├── firebase.ts        # Firebase configuration
├── App.tsx           # Main application component
├── App.css           # Application styles
└── index.tsx         # Application entry point
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.