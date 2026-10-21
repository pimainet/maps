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
        <div className="empty-note">Đang tải bài viết…</div>
      </Card>
    )
  }

  if (error || !content) {
    return (
      <Card>
        <div className="empty-note error">{error || 'Không tìm thấy bài viết'}</div>
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
              <p className="overline">{isDescription ? 'Giới thiệu doanh nghiệp' : 'Bài đăng Google'}{content.goal ? `: ${content.goal}` : ''}</p>
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
                <h2>Nhận xét về bài viết</h2>
                <p>Kiểm tra chất lượng trước khi đăng</p>
              </div>
            </div>
            <div className="prose">{content.critic_feedback}</div>
          </Card>
        )}

        {content.serp_analysis && (
          <Card>
            <div className="section-head">
              <div>
                <h2>Vì sao bài viết theo hướng này</h2>
                <p>Phân tích AI làm trước khi viết</p>
              </div>
              <Sparkles size={18} />
            </div>
            <div className="prose">{content.serp_analysis}</div>
          </Card>
        )}

        {content.ai_content && !isDescription && (
          <Card>
            <div className="section-head">
              <div>
                <h2>Bản nháp đầu tiên</h2>
                <p>Bản AI viết, chưa chỉnh sửa</p>
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
            <p className={`char-count ${finalText.length > 750 ? 'over' : ''}`}>
              {finalText.length}/750 ký tự (giới hạn của Google cho phần Giới thiệu doanh nghiệp)
            </p>
          )}
          <div className="how-to">
            {isDescription ? (
              <>
                <strong>Cách cập nhật lên Google:</strong> bấm “Copy mô tả”, mở hồ sơ Google của đúng cơ sở, vào mục “Giới thiệu doanh nghiệp”, dán đè lên mô tả cũ rồi lưu. Sau đó quay lại đây và bấm “Đã cập nhật trên Google”.
              </>
            ) : (
              <>
                <strong>Cách đăng lên Google:</strong> bấm “Copy bài”, mở hồ sơ Google của đúng cơ sở, chọn “Thêm bản cập nhật”, dán bài rồi đăng. Sau đó quay lại đây và bấm “Đã đăng trên Google”.
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
                  showToast(isDescription ? 'Đã copy mô tả. Hãy dán vào hồ sơ Google của bạn' : 'Đã copy bài. Hãy dán lên Google của bạn')
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
                  showToast('Chưa có nội dung để lưu')
                  return
                }
                const confirmMsg = isDescription
                  ? 'Xác nhận bạn ĐÃ cập nhật mô tả này vào Google Business Profile (đúng cơ sở)?'
                  : 'Xác nhận bạn ĐÃ đăng bài này lên Google Business Profile (đúng cơ sở)?'
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
