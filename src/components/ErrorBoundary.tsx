import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected application error' };
  }

  render() {
    if (this.state.hasError) {
      let parsedDetail: { error?: string; operationType?: string; path?: string } | null = null;
      try {
        parsedDetail = JSON.parse(this.state.message);
      } catch {
        parsedDetail = null;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-slate-900">Action Blocked or Interrupted</h2>
            <p className="mt-2 text-sm text-slate-600">
              {parsedDetail?.error ?? this.state.message}
            </p>
            {parsedDetail?.path ? (
              <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700">
                {parsedDetail.operationType?.toUpperCase()} · {parsedDetail.path}
              </div>
            ) : null}
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="mt-5 px-4 py-2 rounded-lg bg-[#0F3D2E] text-white text-sm font-medium hover:bg-[#0B2E22] transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
