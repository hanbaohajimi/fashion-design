import { SlidersHorizontal } from 'lucide-react';
import './customize.css';

interface CustomizePageProps {
  user: { email: string; name: string; auth_token: string };
}

export default function CustomizePage({ user }: CustomizePageProps) {
  return (
    <div className="customize-page">
      <div className="customize-header">
        <SlidersHorizontal className="w-6 h-6" strokeWidth={1.5} />
        <h1 className="customize-title">个性化</h1>
      </div>
      <p className="customize-desc">用户偏好、模型设置和风格偏好设置将在这里提供。</p>
      <div className="customize-placeholder">
        <p className="customize-placeholder-text">个性化档案管理</p>
        <p className="customize-placeholder-hint">
          当前版本的个人档案设置可通过右上角用户菜单中的「个性化档案」访问。
          后续版本将在此处提供完整的偏好配置界面。
        </p>
      </div>
    </div>
  );
}
