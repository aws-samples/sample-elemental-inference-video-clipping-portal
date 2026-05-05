# Event Media Dashboard

A comprehensive React-based web application for managing live streaming events and creating highlight clips. Built with Vite, AWS Amplify, and AWS Cloudscape Design System.

## Features

- **Event Management**: View, create, and manage live streaming events
- **Clip Creation**: Generate highlight clips from live events
- **Highlight Reels**: Build and manage video compilations
- **Video Feedback**: Provide frame-specific feedback on video content
- **AWS Integration**: Leverages AWS Cognito for authentication and API Gateway for backend services

## Technology Stack

- **Frontend**: React 18+ with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Framework**: AWS Cloudscape Design System
- **Authentication**: AWS Amplify Auth with Amazon Cognito
- **API**: AWS API Gateway integration
- **Testing**: Vitest with React Testing Library
- **Routing**: React Router v6

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- AWS Account (for production deployment)

### Installation

1. Clone the repository and navigate to the project directory
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment configuration:
   ```bash
   cp .env.example .env.development
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

### Environment Configuration

The application dynamically loads AWS Amplify configuration from `/config.json`, which is generated during CDK deployment and served via CloudFront.

**Local Development Setup:**

Create a `.env.local` file with your deployed CloudFront URL:
```bash
VITE_CLOUDFRONT_URL="https://your-cloudfront-id.cloudfront.net"
VITE_API_BASE_URL="https://your-cloudfront-id.cloudfront.net"
```

The Vite dev server proxies requests to the deployed CloudFront distribution, allowing local development to use the deployed backend configuration.

Environment variables:
- `VITE_CLOUDFRONT_URL`: CloudFront distribution URL for proxying config and API requests
- `VITE_API_BASE_URL`: Base URL for API requests (typically same as VITE_CLOUDFRONT_URL)
- `VITE_AWS_REGION`: AWS region (default: `us-west-2`)
- `VITE_DEV_MODE`: Enable development mode features (default: `true`)

### Development Mode

In development mode (`VITE_DEV_MODE=true`), the application uses mock data services to simulate API responses. This allows for development without requiring a full AWS backend setup.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run test:ui` - Run tests with UI
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── common/         # Common components (Layout, DataTable, etc.)
│   ├── events/         # Event-related components
│   ├── clips/          # Clip management components
│   ├── reels/          # Highlight reel components
│   └── feedback/       # Video feedback components
├── pages/              # Page components
├── services/           # API and business logic services
├── hooks/              # Custom React hooks
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
└── contexts/           # React contexts
```

## AWS Integration

The application integrates with AWS services:

- **AWS Cognito**: User authentication and authorization
- **API Gateway**: RESTful API endpoints
- **S3**: Video file storage and thumbnails
- **CloudFront**: Content delivery network
- **MediaLive**: Live streaming integration

### Configuration Loading

The application loads AWS Amplify configuration dynamically from an API Gateway endpoint. This allows for environment-specific configurations without rebuilding the application.

## Testing

The project uses Vitest and React Testing Library for testing:

- Unit tests for components and services
- Integration tests for API services
- Mock services for development and testing

Run tests:
```bash
npm run test
```

## Deployment

The application is designed to be deployed using AWS Amplify hosting with CI/CD integration. The build process optimizes the application for production deployment.

## Contributing

1. Follow the existing code style and patterns
2. Write tests for new features
3. Update documentation as needed
4. Use conventional commit messages