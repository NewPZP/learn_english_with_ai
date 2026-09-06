import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { channels } from '../lib/channels'
import { routes } from '../routes'

/**
 * 发现页（频道广场）：渲染所有注册频道为大卡片
 * 可用频道可点击进入频道详情页；不可用频道显示"即将上线"遮罩
 */
export function DiscoverPage() {
  return (
    <div className="app-content-inner">
      <header className="top-bar">
        <h1 className="top-bar-title">发现</h1>
      </header>
      <p className="discover-intro">浏览精选频道，发现适合你的英语学习内容</p>
      <div className="channel-grid">
        {channels.map((channel) => {
          const Icon = channel.icon
          if (!channel.available) {
            return (
              <div key={channel.id} className="channel-card channel-card-unavailable" data-testid={`channel-card-${channel.id}`}>
                <div className="channel-card-icon">
                  <Icon size={32} />
                </div>
                <div className="channel-card-body">
                  <h2 className="channel-card-name">{channel.name}</h2>
                  <p className="channel-card-desc">{channel.description}</p>
                </div>
                <div className="channel-card-overlay">
                  <span>即将上线</span>
                </div>
              </div>
            )
          }
          return (
            <Link
              key={channel.id}
              to={routes.discoverChannel(channel.id)}
              className="channel-card channel-card-available"
              data-testid={`channel-card-${channel.id}`}
              data-dom-id={`cta-channel-${channel.id}`}
            >
              <div className="channel-card-icon">
                <Icon size={32} />
              </div>
              <div className="channel-card-body">
                <h2 className="channel-card-name">{channel.name}</h2>
                <p className="channel-card-desc">{channel.description}</p>
              </div>
              <ArrowRight className="channel-card-arrow" size={20} />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
