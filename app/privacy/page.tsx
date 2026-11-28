import type { Metadata } from 'next'
import Link from 'next/link'
import { EntityBlock, LegalPage } from '@/components/legal/legal-page'
import { PROCESSORS } from '@/lib/privacy/processors'
import { DELETION_GRACE_DAYS, LEGAL_ENTITY } from '@/lib/privacy/policy'

export const metadata: Metadata = { title: 'Chính sách bảo mật — Local Growth OS' }

// Nội dung theo Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (Điều 4, 9, 14, 20), Nghị định 356/2025/NĐ-CP (Điều 5, 6),
// Luật Thương mại điện tử 122/2025/QH15 (Điều 11). Danh sách bên xử lý: lib/privacy/processors.ts.
export default function PrivacyPage() {
  return (
    <LegalPage title="Chính sách bảo mật và xử lý dữ liệu cá nhân">
      <p>
        Chính sách này giải thích {LEGAL_ENTITY.productName} thu thập dữ liệu cá nhân nào, để làm gì, chia sẻ cho ai, lưu
        bao lâu và bạn có những quyền gì theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định 356/2025/NĐ-CP.
      </p>

      <h2>1. Ai chịu trách nhiệm về dữ liệu của bạn</h2>
      <p>Bên kiểm soát và xử lý dữ liệu cá nhân:</p>
      <EntityBlock />
      <p>
        Với dữ liệu khách hàng của doanh nghiệp bạn (ví dụ người viết review, khách hàng trong ghi chú), bạn là bên kiểm
        soát dữ liệu và chúng tôi là bên xử lý theo yêu cầu của bạn. Với gói <em>Làm hộ</em>, phụ lục xử lý dữ liệu trong
        hợp đồng dịch vụ quy định chi tiết trách nhiệm hai bên.
      </p>

      <h2>2. Dữ liệu chúng tôi xử lý</h2>
      <ul>
        <li>
          <strong>Tài khoản:</strong> họ tên, email, mật khẩu (đã mã hoá một chiều bởi Supabase), ảnh đại diện và email khi
          bạn đăng nhập bằng Google, vai trò trong không gian làm việc.
        </li>
        <li>
          <strong>Dữ liệu doanh nghiệp bạn nhập:</strong> tên, ngành, khu vực, số điện thoại, người liên hệ, link Google
          Maps, ghi chú, ảnh bạn tải lên, nội dung bài đăng, việc cần làm.
        </li>
        <li>
          <strong>Dữ liệu công khai trên Google Maps</strong> của doanh nghiệp bạn và đối thủ: thông tin hồ sơ, điểm sao,
          nội dung review và <em>tên hiển thị công khai của người viết review</em>. Chúng tôi không lưu ảnh đại diện hay link
          hồ sơ của người viết review.
        </li>
        <li>
          <strong>Kết nối Google Business Profile</strong> (khi bạn chủ động kết nối): email tài khoản Google, mã truy cập
          (đã mã hoá), mã định danh hồ sơ.
        </li>
        <li>
          <strong>Thanh toán:</strong> mã đơn, gói, số tiền, thời điểm; với chuyển khoản, ngân hàng/SePay có thể gửi kèm tên
          và số tài khoản người chuyển, nội dung chuyển khoản. Chúng tôi không nhận và không lưu số thẻ hay thông tin đăng
          nhập ngân hàng.
        </li>
        <li>
          <strong>Kỹ thuật:</strong> địa chỉ IP, loại trình duyệt, thời điểm truy cập, cookie đăng nhập (bắt buộc để giữ phiên
          đăng nhập) và cookie ghi nhớ không gian làm việc. Chúng tôi không dùng cookie quảng cáo.
        </li>
        <li>
          <strong>Bằng chứng đồng ý:</strong> phiên bản chính sách, các mục bạn đồng ý, thời điểm, IP và trình duyệt lúc đồng
          ý.
        </li>
      </ul>
      <p>
        Chúng tôi không chủ đích thu thập dữ liệu cá nhân nhạy cảm. Vui lòng không nhập thông tin sức khoẻ, tôn giáo, số giấy
        tờ tuỳ thân, thông tin tài khoản ngân hàng của khách hàng vào ghi chú. Dịch vụ dành cho người từ 18 tuổi trở lên sử
        dụng cho mục đích kinh doanh.
      </p>

      <h2>3. Mục đích xử lý</h2>
      <ol>
        <li>Tạo và quản lý tài khoản, xác thực đăng nhập, phân quyền thành viên.</li>
        <li>Phân tích hồ sơ Google Maps, lập kế hoạch, gợi ý việc cần làm, soạn nội dung và trả lời review bằng AI.</li>
        <li>Đăng bài, đăng trả lời review lên Google khi bạn duyệt hoặc bật chế độ tự động.</li>
        <li>Gửi email nhắc việc, biên nhận, thông báo dịch vụ (bạn tắt được email nhắc việc trong Cài đặt).</li>
        <li>Thu tiền, xuất biên nhận, đối soát và lưu chứng từ theo pháp luật kế toán, thuế.</li>
        <li>Bảo mật, chống lạm dụng, xử lý sự cố, hỗ trợ khi bạn yêu cầu.</li>
        <li>Chỉ khi bạn đồng ý riêng: gửi email giới thiệu tính năng và ưu đãi.</li>
      </ol>
      <p>
        Chúng tôi không bán dữ liệu cá nhân, không dùng dữ liệu của bạn để quảng cáo cho bên thứ ba và không cho nhà cung cấp
        AI dùng dữ liệu của bạn để huấn luyện mô hình.
      </p>

      <h2>4. Bên nhận dữ liệu và chuyển dữ liệu ra nước ngoài</h2>
      <p>
        Dịch vụ chạy trên hạ tầng của các nhà cung cấp dưới đây, phần lớn đặt ngoài Việt Nam. Theo Điều 20 Luật 91/2025/QH15,
        đây là chuyển dữ liệu cá nhân ra nước ngoài; chúng tôi chỉ chuyển phần dữ liệu cần cho từng mục đích, qua kết nối mã
        hoá.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nhà cung cấp</th>
              <th>Nơi xử lý</th>
              <th>Mục đích</th>
              <th>Dữ liệu</th>
              <th>Lưu trữ</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name}>
                <td>
                  <strong>{p.name}</strong>
                  <small>{p.entity}</small>
                </td>
                <td>{p.country}</td>
                <td>{p.purpose}</td>
                <td>{p.data}</td>
                <td>{p.retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Chúng tôi cũng có thể cung cấp dữ liệu cho cơ quan nhà nước có thẩm quyền khi pháp luật yêu cầu.
      </p>

      <h2>5. Bảo vệ dữ liệu</h2>
      <ul>
        <li>Kết nối HTTPS; dữ liệu lưu trữ được mã hoá ở tầng hạ tầng; mã truy cập Google được mã hoá riêng.</li>
        <li>Phân quyền theo không gian làm việc ở tầng cơ sở dữ liệu (Row Level Security); khoá quản trị chỉ dùng ở máy chủ.</li>
        <li>Chỉ nhân sự được phân công mới truy cập dữ liệu khách hàng khi cần hỗ trợ hoặc thực hiện gói Làm hộ.</li>
        <li>
          Khi có sự cố lộ, mất dữ liệu có thể gây hại, chúng tôi thông báo cho cơ quan chuyên trách trong 72 giờ theo Điều 23
          Luật 91/2025/QH15 và thông báo cho bạn khi cần thiết.
        </li>
      </ul>

      <h2>6. Thời gian lưu trữ</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dữ liệu</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Tài khoản, dữ liệu doanh nghiệp, việc, nội dung</td><td>Đến khi bạn xoá doanh nghiệp / không gian làm việc / tài khoản</td></tr>
            <tr><td>Bản chụp hồ sơ Google Maps (snapshot)</td><td>Dữ liệu thô của nhà cung cấp: không lưu. Nội dung review trong snapshot: 30 ngày. Snapshot cũ: 90 ngày (giữ bản mới nhất)</td></tr>
            <tr><td>Toạ độ lấy từ Google Places API</td><td>Tối đa 30 ngày (điều khoản Google), sau đó lấy lại khi cần</td></tr>
            <tr><td>Tên người viết review trong hộp thư review</td><td>90 ngày sau khi đã xử lý xong, tối đa 365 ngày</td></tr>
            <tr><td>Nhật ký kỹ thuật (đăng bài, đăng trả lời, lượt dùng AI)</td><td>365 ngày</td></tr>
            <tr><td>Yêu cầu tư vấn, đăng ký dùng thử</td><td>730 ngày (địa chỉ IP thô: 30 ngày)</td></tr>
            <tr><td>Bằng chứng đồng ý, hồ sơ xử lý yêu cầu của bạn</td><td>Trong thời gian dùng dịch vụ và 5 năm sau khi xoá tài khoản</td></tr>
            <tr><td>Đơn hàng, thanh toán, giao dịch ngân hàng, biên nhận</td><td>10 năm theo Luật Kế toán (Điều 41) và Nghị định 174/2016/NĐ-CP — vẫn giữ khi bạn xoá tài khoản, được tách khỏi tài khoản</td></tr>
          </tbody>
        </table>
      </div>

      <h2>7. Quyền của bạn</h2>
      <p>
        Theo Điều 4 Luật 91/2025/QH15, bạn có quyền: được biết; đồng ý hoặc không đồng ý, rút lại đồng ý; xem, chỉnh sửa;
        yêu cầu cung cấp, xoá, hạn chế xử lý; phản đối xử lý; khiếu nại, tố cáo, khởi kiện và yêu cầu bồi thường.
      </p>
      <ul>
        <li>
          <strong>Tự làm ngay trong ứng dụng</strong> (Cài đặt → Dữ liệu &amp; quyền riêng tư): tải về toàn bộ dữ liệu (JSON),
          bật/tắt nhận email ưu đãi, gửi yêu cầu xoá tài khoản (có {DELETION_GRACE_DAYS} ngày để huỷ, sau đó xoá vĩnh viễn).
        </li>
        <li>
          <strong>Yêu cầu khác</strong> (chỉnh sửa, hạn chế, phản đối, khiếu nại): gửi email tới {LEGAL_ENTITY.email} từ email
          đăng ký tài khoản.
        </li>
        <li>
          Thời hạn (Nghị định 356/2025/NĐ-CP Điều 5): xác nhận đã nhận trong 02 ngày làm việc; cung cấp / chỉnh sửa trong 10
          ngày; rút đồng ý, hạn chế, phản đối trong 15 ngày; xoá trong 20 ngày. Thời hạn có thể gia hạn một lần khi cần, chúng
          tôi sẽ báo lý do.
        </li>
        <li>
          Rút lại đồng ý không ảnh hưởng tới việc xử lý hợp pháp trước đó. Các mục đồng ý bắt buộc là điều kiện để cung cấp
          dịch vụ; rút lại các mục này đồng nghĩa với ngừng dùng dịch vụ và xoá tài khoản. Một số dữ liệu vẫn được giữ khi
          pháp luật yêu cầu (chứng từ kế toán).
        </li>
        <li>
          Người viết review hoặc khách hàng của doanh nghiệp dùng dịch vụ có thể liên hệ doanh nghiệp đó hoặc liên hệ chúng
          tôi; chúng tôi sẽ phối hợp xử lý.
        </li>
      </ul>

      <h2>8. Rủi ro có thể xảy ra</h2>
      <p>
        Không hệ thống nào an toàn tuyệt đối. Rủi ro gồm truy cập trái phép do lộ mật khẩu, lỗi của nhà cung cấp hạ tầng, hoặc
        nội dung AI soạn chưa chính xác. Hãy dùng mật khẩu mạnh, không chia sẻ tài khoản, và luôn đọc lại nội dung trước khi
        đăng.
      </p>

      <h2>9. Thay đổi chính sách</h2>
      <p>
        Khi thay đổi đáng kể, chúng tôi cập nhật phiên bản ở đầu trang và đề nghị bạn xác nhận lại khi đăng nhập. Xem thêm{' '}
        <Link href="/terms">Điều khoản sử dụng</Link>.
      </p>
    </LegalPage>
  )
}
