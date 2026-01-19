'use client';

import React, { ReactNode, ReactElement } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactElement;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary Component
 * Catches errors in child components and displays fallback UI
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        this.props.fallback?.(this.state.error, this.resetError) || (
          <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md w-full">
              <h1 className="text-2xl font-bold text-red-900 mb-2">Something went wrong</h1>
              <p className="text-red-700 mb-4 text-sm">
                {this.state.error.message || 'An unexpected error occurred'}
              </p>
              <details className="mb-4 cursor-pointer">
                <summary className="text-sm text-red-600 hover:text-red-800">
                  Error details
                </summary>
                <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto max-h-40">
                  {this.state.error.stack}
                </pre>
              </details>
              <button
                onClick={this.resetError}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded transition"
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * Hook for handling async errors in function components
 */
export function useErrorHandler(): (error: Error) => void {
  const [, setError] = React.useState<Error | null>(null);

  return React.useCallback((error: Error) => {
    setError(() => {
      throw error;
    });
  }, []);
}

/**
 * Fallback component for media loading errors
 */
export function MediaErrorFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-gray-100 rounded-lg p-4">
      <div className="text-center">
        <svg
          className="w-12 h-12 text-gray-400 mx-auto mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <h3 className="text-sm font-medium text-gray-900 mb-1">Failed to load media</h3>
        <p className="text-xs text-gray-500 mb-3">{error.message}</p>
        <button
          onClick={reset}
          className="text-xs bg-gray-300 hover:bg-gray-400 text-gray-900 px-3 py-1 rounded transition"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/**
 * Fallback component for API errors
 */
export function ApiErrorFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): ReactElement {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 my-4">
      <div className="flex">
        <div className="shrink-0">
          <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-yellow-800">Unable to fetch data</h3>
          <div className="mt-2 text-sm text-yellow-700">{error.message}</div>
          <div className="mt-4">
            <button
              onClick={reset}
              className="inline-block bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-xs transition"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
