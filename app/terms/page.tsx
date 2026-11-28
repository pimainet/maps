import type { Metadata } from 'next'
import Link from 'next/link'
import { EntityBlock, LegalPage } from '@/components/legal/legal-page'
import { LEGAL_ENTITY } from '@/lib/privacy/policy'
import { MONTHLY_PRICE_VND, PERIOD_DISCOUNT, PLAN_LABEL } from '@/lib/billing/plans'

export const metadata: Metadata = { title: 'Điều khoản sử dụng — Local Growth OS' }

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'

// Nội dung bắt buộc công khai theo Luật Thương mại điện tử 122/2025/QH15 Điều 11: thông tin chủ quản, chính sách bảo mật,
// quyền và nghĩa vụ các bên, cách giải quyết khiếu nại; với chức năng đặt hàng: giá, thanh toán, cách cung cấp dịch vụ,
// chấm dứt dịch vụ và hoàn tiền.
export default function TermsPage() {
  return (
    <LegalPage title="Điều khoản sử dụng">
      <h2>1. Đơn vị cung cấp dịch vụ</h2>
      <EntityBlock />
      <p>
        {LEGAL_ENTITY.productName} là phần mềm giúp doanh nghiệp địa phương cải thiện hồ sơ Google Maps / Google Business
        Profile. Chúng tôi là đơn vị độc lập, <strong>không phải đối tác, không được Google tài trợ hay xác nhận</strong>.
      </p>

      <h2>2. Tài khoản</h2>
      <ul>
        <li>Bạn từ 18 tuổi trở lên, cung cấp thông tin đăng ký đúng và tự bảo mật mật khẩu.</li>
        <li>Bạn chịu trách nhiệm về hoạt động trong tài khoản và không gian làm việc của mình, kể cả của thành viên bạn mời.</li>
        <li>
          Khi đăng ký, bạn đồng ý Điều khoản này và <Link href="/privacy">Chính sách bảo mật</Link> bằng cách đánh dấu vào ô
          đồng ý (Luật Thương mại điện tử 2025, Điều 11 khoản 4).
        </li>
      </ul>

      <h2>3. Cách sử dụng được phép</h2>
      <ul>
        <li>
          Chỉ thêm và quản lý hồ sơ doanh nghiệp mà bạn sở hữu hoặc được chủ doanh nghiệp uỷ quyền. Trả lời review, đăng bài
          thay chủ doanh nghiệp chỉ khi đã được họ cho phép (chính sách Business Profile APIs của Google).
        </li>
        <li>
          Không dùng dịch vụ để tạo review giả, nội dung sai sự thật, vi phạm quyền sở hữu trí tuệ, quyền riêng tư hoặc chính
          sách nội dung của Google; không thu thập dữ liệu cá nhân của người khác trái pháp luật.
        </li>
        <li>Không dò quét, tấn công, dịch ngược hoặc dùng tài khoản để truy cập tự động trái phép vào hệ thống.</li>
        <li>
          Với dữ liệu khách hàng của doanh nghiệp bạn đưa vào hệ thống, bạn là bên kiểm soát dữ liệu và phải có căn cứ hợp
          pháp để xử lý theo Luật Bảo vệ dữ liệu cá nhân 2025.
        </li>
      </ul>

      <h2>4. Nội dung do AI tạo và dữ liệu bên thứ ba</h2>
      <ul>
        <li>
          Gợi ý, bài viết và trả lời review do AI soạn có thể chưa chính xác. Bạn (hoặc nhân viên của chúng tôi với gói Làm hộ,
          theo phạm vi đã thoả thuận) cần đọc lại trước khi đăng.
        </li>
        <li>
          Số liệu về Google Maps đến từ Google và nhà cung cấp dữ liệu công khai; có thể chậm hoặc khác với hiển thị thực tế.
          Chúng tôi không cam kết kết quả thứ hạng hay lượng khách cụ thể.
        </li>
      </ul>

      <h2>5. Giá và thanh toán</h2>
      <ul>
        <li>Gói {PLAN_LABEL.free}: dùng thử các tính năng cơ bản, có giới hạn.</li>
        <li>
          Gói {PLAN_LABEL.basic}: {vnd(MONTHLY_PRICE_VND.basic)}/tháng. Gói {PLAN_LABEL.full}: {vnd(MONTHLY_PRICE_VND.full)}
          /tháng. Trả trước 3 tháng giảm {PERIOD_DISCOUNT[3] * 100}%, 12 tháng giảm {PERIOD_DISCOUNT[12] * 100}%.
        </li>
        <li>
          Gói {PLAN_LABEL.done_for_you}: từ {vnd(MONTHLY_PRICE_VND.done_for_you)}/tháng, bán qua tư vấn và hợp đồng riêng (kèm
          phụ lục xử lý dữ liệu).
        </li>
        <li>
          Thanh toán bằng chuyển khoản ngân hàng theo mã đơn và mã QR trên trang Thanh toán; gói được kích hoạt tự động khi hệ
          thống nhận được tiền. Gói <strong>không tự động gia hạn</strong>; chúng tôi gửi email nhắc trước khi hết hạn. Hết hạn
          và quá thời gian ân hạn, tài khoản tự về gói Miễn phí, dữ liệu vẫn được giữ.
        </li>
        <li>Giá đã gồm / chưa gồm thuế: [CHƯA ĐIỀN — xác nhận theo tư cách nộp thuế của đơn vị].</li>
      </ul>

      <h2>6. Chấm dứt dịch vụ và hoàn tiền</h2>
      <ul>
        <li>
          Bạn có thể ngừng dùng bất cứ lúc nào và tự yêu cầu xoá tài khoản trong Cài đặt → Dữ liệu &amp; quyền riêng tư.
        </li>
        <li>
          Chúng tôi có thể tạm khoá tài khoản vi phạm mục 3 sau khi thông báo (trừ trường hợp khẩn cấp để bảo vệ hệ thống hoặc
          người khác).
        </li>
        <li>Chuyển khoản thừa, chuyển nhầm hoặc trùng: hoàn lại phần chênh lệch sau khi đối soát.</li>
        <li>
          Hoàn tiền cho thời gian chưa dùng: [CHƯA CHỐT — chủ doanh nghiệp quyết định, ví dụ: hoàn 100% nếu yêu cầu trong 7
          ngày đầu của kỳ trả phí đầu tiên; sau đó không hoàn cho kỳ đang dùng].
        </li>
        <li>Gói Làm hộ: điều kiện chấm dứt, hoàn tiền theo hợp đồng dịch vụ đã ký.</li>
      </ul>

      <h2>7. Kết nối Google</h2>
      <p>
        Khi bạn kết nối Google Business Profile, chúng tôi chỉ dùng quyền được cấp để đọc dữ liệu hồ sơ, đăng bài và đăng trả
        lời review theo thao tác hoặc thiết lập của bạn. Bạn có thể ngắt kết nối bất cứ lúc nào trong ứng dụng hoặc tại trang
        quản lý quyền truy cập tài khoản Google; khi bạn ngừng dùng dịch vụ, chúng tôi xoá mã truy cập và hỗ trợ bạn lấy lại
        toàn quyền hồ sơ trong 07 ngày làm việc.
      </p>

      <h2>8. Giới hạn trách nhiệm</h2>
      <p>
        Trong phạm vi pháp luật cho phép, trách nhiệm bồi thường của chúng tôi với mỗi sự việc không vượt quá số tiền bạn đã
        trả cho dịch vụ trong 03 tháng gần nhất. Chúng tôi không chịu trách nhiệm cho thay đổi chính sách, thuật toán hoặc
        việc tạm ngừng của Google và các nền tảng bên thứ ba.
      </p>

      <h2>9. Phản ánh, khiếu nại</h2>
      <p>
        Gửi tới {LEGAL_ENTITY.email} hoặc {LEGAL_ENTITY.phone}. Chúng tôi xác nhận đã nhận trong 02 ngày làm việc và trả lời
        trong tối đa 15 ngày. Tranh chấp được ưu tiên thương lượng; nếu không thành, giải quyết tại Toà án có thẩm quyền tại
        Việt Nam theo pháp luật Việt Nam.
      </p>

      <h2>10. Thay đổi điều khoản</h2>
      <p>
        Khi thay đổi đáng kể, chúng tôi cập nhật phiên bản ở đầu trang và đề nghị bạn xác nhận lại khi đăng nhập.
      </p>
    </LegalPage>
  )
}
