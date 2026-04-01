'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/lib/auth';
import { getApiBase } from '@/lib/api';

interface PinFormData {
  pin: string;
}

export default function LoginScreen() {
  const apiUrl = getApiBase()

  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<PinFormData>({
    defaultValues: { pin: '' }
  });

  const pinValue = watch('pin');

  const onSubmit = async (data: PinFormData) => {
    if (data.pin.length !== 6) {
      setError('PIN must be exactly 6 digits');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: data.pin }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        login(result.token, result.userId);
      } else {
        setError(result.error || 'Invalid PIN');
        setValue('pin', ''); // Clear PIN on error
      }
    } catch (err) {
      setError('Connection failed. Please try again.');
      console.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setValue('pin', value);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="surface-panel p-8">
          {/* Logo/Header */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-linear-to-br from-[var(--primary)] to-[var(--primary-container)] rounded-full mx-auto mb-4 flex items-center justify-center shadow-lg">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h1 className="editorial-title text-4xl mb-2">Welcome Back</h1>
            <p className="text-[var(--surface-muted)]">Enter your 6-digit PIN to continue</p>
          </div>

          {/* PIN Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-[var(--surface-ink)] mb-2">
                PIN
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                {...register('pin', { 
                  required: 'PIN is required',
                  pattern: {
                    value: /^\d{6}$/,
                    message: 'PIN must be exactly 6 digits'
                  }
                })}
                onChange={handlePinInput}
                disabled={isLoading}
                className="focus-ring w-full px-4 py-3 bg-[var(--surface-high)] rounded-2xl text-[var(--surface-ink)] text-center text-2xl tracking-widest border border-transparent focus:bg-[var(--surface-lowest)] focus:border-[var(--secondary)] transition disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="••••••"
                autoFocus
                autoComplete="off"
              />
              
              {/* PIN indicator dots */}
              <div className="flex justify-center gap-3 mt-4">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div
                    key={index}
                    className={`w-3 h-3 rounded-full transition-all ${
                      pinValue.length > index
                        ? 'bg-[var(--secondary)] scale-110'
                        : 'bg-[var(--outline-variant)]'
                    }`}
                  />
                ))}
              </div>

              {errors.pin && (
                <p className="mt-2 text-sm text-[var(--error)]">{errors.pin.message}</p>
              )}
            </div>

            {error && (
              <div className="bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-2xl p-3">
                <p className="text-sm text-[var(--error)] text-center">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || pinValue.length !== 6}
              className="focus-ring w-full py-3 px-4 bg-linear-to-r from-[var(--primary)] to-[var(--primary-container)] text-[var(--on-primary)] font-semibold rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Authenticating...
                </span>
              ) : (
                'Unlock'
              )}
            </button>
          </form>

          {/* Help text */}
          <div className="mt-6 text-center">
            <p className="text-sm text-[var(--surface-muted)]">
              Don&apos;t have access? Contact your administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
