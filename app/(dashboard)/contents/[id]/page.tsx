'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, FileText, Sparkles } from 'lucide-react'
import { Badge, Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

export default function ContentDetailPage() {
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const contentId = params.id

  const [content, setContentData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [finalText, setFinalText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/content/${contentId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được bài viết')

        setContentData(data)
        setFinalText(data.final_content || data.ai_content || '')
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [contentId])

  async function patch(body: any, successMsg: string) {
    if (!content) return
    setSaving(true)
    try {
      const res = await fetch(`/api/content/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cập nhật thất bại')
      setContentData(data)
      if (typeof data.final_content === 'string' && data.final_content) {
        setFinalText(data.final_content)
      }
      showToast(successMsg)
    } catch (err: any) {
      showToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải bài viết...</div>
      </Card>
    )
  }

  if (error || !content) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>{error || 'Không tìm thấy bài viết'}</div>
      </Card>
    )
  }

  const isDescription = content.channel === 'gbp_description'

  return (
    <>
      <Card className="content-meta">
        <div>
          <div className="title-line">
            <div className="doc-icon large">
              <FileText size={19} />
            </div>
            <div>
              <p className="overline">{isDescription ? 'MÔ TẢ HỒ SƠ (GIỚI THIỆU DOANH NGHIỆP)' : 'GBP POST'}{content.goal ? ` · ${content.goal}` : ''}</p>
              <h2>{content.topic || 'Không có tiêu đề'}</h2>
            </div>
          </div>
        </div>
        <Badge status={content.status || 'drafted'} />
      </Card>

      <div className="content-review">
        {content.critic_feedback && (
          <Card className="critic-card">
            <div className="section-head">
              <div>
                <h2>Nhận xét Critic</h2>
                <p>Kiểm tra chất lượng trước khi xuất bản</p>
              </div>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{content.critic_feedback}</div>
          </Card>
        )}

        {content.serp_analysis && (
          <Card>
            <div className="section-head">
              <div>
                <h2>Phân tích SERP-Aware</h2>
                <p>Góc nhìn từ AI trước khi viết</p>
              </div>
              <Sparkles size={18} />
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{content.serp_analysis}</div>
          </Card>
        )}

        {content.ai_content && !isDescription && (
          <Card>
            <div className="section-head">
              <div>
                <h2>Bản nháp</h2>
                <p>AI Writer v1</p>
              </div>
            </div>
            <div className="draft-box">{content.ai_content}</div>
          </Card>
        )}

        <Card>
          <div className="section-head">
            <div>
              <h2>Bản cuối</h2>
              <p>Chỉnh sửa nội dung trước khi duyệt</p>
            </div>
          </div>
          <textarea className="final-editor" value={finalText} onChange={(e) => setFinalText(e.target.value)} />
          {isDescription && (
            <p style={{ marginTop: -8, marginBottom: 8, fontSize: 12, color: finalText.length > 750 ? '#dc2626' : '#6b7280' }}>
              {finalText.length}/750 ký tự (giới hạn của Google cho phần Giới thiệu doanh nghiệp)
            </p>
          )}
          <div
            style={{
              marginTop: 12,
              marginBottom: 8,
              padding: 12,
              background: '#f8fafc',
              borderRadius: 8,
              fontSize: 13,
              color: '#475569',
              lineHeight: 1.5,
            }}
          >
            {isDescription ? (
              <>
                <strong>Quy trình cập nhật tay trên Google:</strong> Copy nội dung → mở Google Business Profile đúng location → vào mục
                "Giới thiệu doanh nghiệp" → dán đè lên mô tả cũ → lưu → quay lại đây bấm「Đã cập nhật trên Google」.
              </>
            ) : (
              <>
                <strong>Quy trình đăng tay trên Google:</strong> Copy bài → mở Google Business Profile đúng location → dán bài → đăng →
                quay lại đây bấm「Đã đăng trên Google」.
              </>
            )}
          </div>
          <div className="editor-actions">
            <button
              className="secondary-button"
              disabled={saving || !finalText.trim()}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(finalText)
                  showToast(isDescription ? 'Đã copy mô tả — dán vào hồ sơ Google Business Profile' : 'Đã copy bài — dán lên Google Business Profile')
                } catch {
                  showToast('Không copy được. Hãy chọn toàn bộ text và copy thủ công (Ctrl+C).')
                }
              }}
            >
              {isDescription ? 'Copy mô tả' : 'Copy bài'}
            </button>
            <button className="secondary-button" disabled={saving} onClick={() => patch({ final_content: finalText }, 'Đã lưu chỉnh sửa')}>
              <Check size={16} />
              Lưu chỉnh sửa
            </button>
            <button
              className="primary-button"
              disabled={saving || !finalText.trim()}
              onClick={() =>
                patch(
                  { final_content: finalText, status: 'approved' },
                  isDescription ? 'Đã duyệt mô tả — có thể copy và cập nhật lên Google' : 'Đã duyệt bài — có thể copy và đăng lên Google'
                )
              }
            >
              <Check size={16} />
              {isDescription ? 'Duyệt mô tả' : 'Duyệt bài'}
            </button>
            <button
              className="primary-button"
              disabled={saving || !finalText.trim()}
              onClick={() => {
                if (!finalText.trim()) {
                  showToast('Chưa có nội dung')
                  return
                }
                const confirmMsg = isDescription
                  ? 'Xác nhận bạn ĐÃ cập nhật mô tả này vào Google Business Profile (đúng location)?'
                  : 'Xác nhận bạn ĐÃ đăng bài này lên Google Business Profile (đúng location)?'
                if (!window.confirm(confirmMsg)) {
                  return
                }
                patch(
                  { final_content: finalText, status: 'published' },
                  isDescription ? 'Đã ghi nhận: mô tả đã cập nhật trên Google' : 'Đã ghi nhận: bài đã đăng trên Google'
                )
              }}
            >
              {isDescription ? 'Đã cập nhật trên Google' : 'Đã đăng trên Google'}
            </button>
          </div>
        </Card>
      </div>
    </>
  )
}
