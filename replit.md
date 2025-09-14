# Overview

DEXX-TER is a robust license management system designed for game hack resellers. The application provides comprehensive key generation, administration, and tracking capabilities with role-based access control supporting both administrators and resellers. The system features a modern React frontend with a clean, responsive dark-themed UI, while the backend handles authentication, key management, and data persistence through JSON file storage.

## Recent Changes (September 2025)

- **Online Updates Feature**: Implemented complete online update management system allowing admins to send update messages to app users with optional action buttons and links. Features include:
  - Mobile-responsive admin panel for creating, editing, and managing updates
  - Public API endpoint (/api/updates) for app users to fetch active updates
  - Complete CRUD operations with form validation and real-time UI updates
  - Comprehensive API documentation with usage examples
  - Enhanced security with CSRF protection and secure session management

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The client is built using modern React with TypeScript, utilizing a component-based architecture centered around:

- **React Router**: Uses Wouter for lightweight client-side routing with protected routes based on user roles
- **State Management**: React Query (TanStack Query) for server state management and caching
- **UI Framework**: shadcn/ui components built on Radix UI primitives with TailwindCSS for styling
- **Form Handling**: React Hook Form with Zod validation for type-safe form management
- **Authentication**: Context-based auth provider with session management
- **Build Tool**: Vite for fast development and optimized production builds

The application implements a clean separation between admin and reseller interfaces, with dedicated layouts and page components for each role. The UI features a dark theme with purple accents and includes mobile-responsive design patterns.

## Backend Architecture

The server follows an Express.js architecture with several key design decisions:

- **File-based Storage**: Uses JSON files instead of a traditional database, with individual files per reseller and shared data files
- **Session Management**: Express sessions with Passport.js for authentication, supporting both admin and reseller login flows
- **API Design**: RESTful endpoints organized by user role (/api/admin/* and /api/reseller/*)
- **Direct Database Module**: Custom JSON file operations through a direct-db.mjs module for data persistence
- **Build Process**: ESBuild for server bundling with custom build scripts for deployment

The storage system creates individual JSON files for each reseller containing their keys and credits, while maintaining shared files for admins, tokens, and global data. This approach provides simple deployment without database dependencies while maintaining data isolation between users.

## Authentication & Authorization

The system implements a role-based authentication system with two distinct user types:

- **Admins**: Full system access including reseller management, token generation, and global statistics
- **Resellers**: Limited access to their own key generation, management, and profile data

Authentication uses Passport.js local strategy with session-based persistence. The frontend implements protected routes that redirect based on user role, ensuring proper access control throughout the application.

## Data Architecture

The application uses a JSON file-based storage system with the following structure:

- Individual reseller files (e.g., `data/username.json`) containing keys and credits
- Shared data files for admins, tokens, devices, and global keys
- Direct file operations through a custom database abstraction layer
- Data isolation ensuring resellers can only access their own information

This approach eliminates database setup requirements while providing adequate performance for the target use case of game license management.

# External Dependencies

## Core Dependencies

- **@neondatabase/serverless**: Database connector (configured but not actively used due to JSON storage choice)
- **drizzle-orm & drizzle-kit**: Database ORM and migration tools (configured for potential future PostgreSQL migration)
- **@radix-ui/***: Comprehensive UI component primitives for building the shadcn/ui interface
- **@tanstack/react-query**: Server state management and caching solution
- **passport & passport-local**: Authentication framework and local strategy implementation

## Development & Build Tools

- **vite & @vitejs/plugin-react**: Modern build tool and React plugin for development and production builds
- **esbuild**: Fast JavaScript bundler for server-side code compilation
- **tailwindcss**: Utility-first CSS framework for styling
- **typescript & tsx**: TypeScript runtime and development tools

## Form & Validation

- **react-hook-form**: Performant form library with minimal re-renders
- **zod & @hookform/resolvers**: Schema validation and form integration
- **@radix-ui/react-***: UI component primitives for form elements

## Deployment & Hosting

The application is configured for deployment on Render with:
- Automatic build scripts that handle both client and server compilation
- Environment variable configuration for production settings
- Persistent disk storage for JSON data files
- Custom deployment scripts ensuring proper directory structure

The system can operate without external database services, making it suitable for simple hosting environments while maintaining the flexibility to migrate to PostgreSQL using the pre-configured Drizzle setup.