import { useState } from 'react';

interface AuthPageProps {
  onLogin: (user: { email: string; name: string; auth_token: string }) => void;
  onBack: () => void;
}

type AuthMode = 'login' | 'register';

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  name?: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(pw: string): { valid: boolean; message: string } {
  if (pw.length < 8) return { valid: false, message: '至少 8 个字符' };
  if (!/[a-zA-Z]/.test(pw)) return { valid: false, message: '需包含字母' };
  if (!/[0-9]/.test(pw)) return { valid: false, message: '需包含数字' };
  return { valid: true, message: '密码强度符合要求' };
}

export default function AuthPage({ onLogin, onBack }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  const pwCheck = validatePassword(password);

  const handleLogin = async () => {
    setSubmitError('');
    const errs: FormErrors = {};
    if (!email.trim()) errs.email = '请输入邮箱';
    else if (!validateEmail(email)) errs.email = '邮箱格式不正确';
    if (!password) errs.password = '请输入密码';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/design/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.detail || '登录失败'); return; }
      onLogin({ email: data.email, name: data.name, auth_token: data.auth_token });
    } catch {
      setSubmitError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setSubmitError('');
    const errs: FormErrors = {};
    if (!name.trim()) errs.name = '请输入昵称';
    if (!email.trim()) errs.email = '请输入邮箱';
    else if (!validateEmail(email)) errs.email = '邮箱格式不正确';
    if (!password) errs.password = '请输入密码';
    else if (!pwCheck.valid) errs.password = pwCheck.message;
    if (password !== confirmPw) errs.confirmPassword = '两次密码不一致';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/design/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.detail || '注册失败'); return; }
      onLogin({ email: data.email, name: data.name, auth_token: data.auth_token });
    } catch {
      setSubmitError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (mode === 'login' ? handleLogin() : handleRegister());
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center">
      {/* Background */}
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=1920&q=85)`,
        }}
      />
      <div className="fixed inset-0 bg-black/40" style={{ backdropFilter: 'blur(2px)' }} />

      {/* Auth Card */}
      <div className="relative z-10 w-full max-w-[420px] mx-4">
        <div
          className="rounded-2xl p-10"
          style={{
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(40px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
          }}
        >
          {/* Back button */}
          <button
            onClick={onBack}
            className="mb-6 text-white/50 hover:text-white/80 text-[12px] flex items-center gap-1 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            返回
          </button>

          {/* Title */}
          <h1 className="font-display text-white text-[28px] font-bold mb-1">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="text-white/50 text-[13px] mb-8">
            {mode === 'login' ? '登录以继续使用 AI Fashion Design Platform' : '开始你的时尚设计之旅'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name (register only) */}
            {mode === 'register' && (
              <div>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="昵称"
                  className="auth-input text-white placeholder:text-white/30"
                  style={{ borderBottomColor: errors.name ? '#ef4444' : 'rgba(255,255,255,0.2)' }}
                />
                {errors.name && <p className="text-red-400 text-[11px] mt-1">{errors.name}</p>}
              </div>
            )}

            {/* Email */}
            <div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="邮箱地址"
                className="auth-input text-white placeholder:text-white/30"
                style={{ borderBottomColor: errors.email ? '#ef4444' : 'rgba(255,255,255,0.2)' }}
              />
              {errors.email && <p className="text-red-400 text-[11px] mt-1">{errors.email}</p>}
            </div>

            {/* Password */}
            <div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="密码"
                className="auth-input text-white placeholder:text-white/30"
                style={{ borderBottomColor: errors.password ? '#ef4444' : 'rgba(255,255,255,0.2)' }}
              />
              {errors.password && <p className="text-red-400 text-[11px] mt-1">{errors.password}</p>}
              {mode === 'register' && password && (
                <p className={`text-[11px] mt-1 ${pwCheck.valid ? 'text-green-400' : 'text-amber-400'}`}>
                  {pwCheck.message}
                </p>
              )}
            </div>

            {/* Confirm Password (register only) */}
            {mode === 'register' && (
              <div>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="确认密码"
                  className="auth-input text-white placeholder:text-white/30"
                  style={{ borderBottomColor: errors.confirmPassword ? '#ef4444' : 'rgba(255,255,255,0.2)' }}
                />
                {errors.confirmPassword && <p className="text-red-400 text-[11px] mt-1">{errors.confirmPassword}</p>}
              </div>
            )}

            {/* Submit error */}
            {submitError && (
              <div className="text-red-400 text-[13px] text-center py-2 bg-red-500/10 rounded-lg">
                {submitError}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 border-[1.5px] border-white/70 text-white text-[13px] font-medium tracking-[0.12em] uppercase
                bg-transparent hover:bg-white/[0.1] transition-all duration-300 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? '处理中...' : (mode === 'login' ? '登 录' : '注 册')}
            </button>
          </form>

          {/* Switch mode */}
          <p className="text-center text-white/40 text-[13px] mt-8">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErrors({}); setSubmitError(''); }}
              className="text-white/80 hover:text-white ml-1 underline underline-offset-4 transition-colors"
            >
              {mode === 'login' ? '立即注册' : '返回登录'}
            </button>
          </p>
        </div>

        {/* Brand */}
        <p className="text-center text-white/30 text-[11px] mt-6 tracking-[0.15em] uppercase">
          AI Fashion Design Platform
        </p>
      </div>
    </div>
  );
}
