# BẢN NHÁP — Hồ sơ đánh giá tác động (DPIA Mẫu 10 + chuyển xuyên biên giới Mẫu 09)

> Bản nháp nội bộ để chuẩn bị điền vào **Mẫu số 10** (đánh giá tác động xử lý DLCN) và **Mẫu số 09** (đánh giá tác động
> chuyển DLCN xuyên biên giới) tại Phụ lục Nghị định 356/2025/NĐ-CP
> ([PDF Công báo](https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/17/356signed-1768638052103952849513.pdf)).
>
> Thông báo gửi hồ sơ:
> - DPIA: Mẫu 02a (tổ chức) / 02b (cá nhân);
> - chuyển xuyên biên giới: Mẫu 01a / 01b.
>
> Nộp cho Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (A05), Bộ Công an — trực tuyến qua Cổng thông tin
> quốc gia về BVDLCN, nộp trực tiếp hoặc qua bưu chính — trong **60 ngày** kể từ ngày đầu xử lý / chuyển
> (Luật 91/2025 Điều 20, 21; NĐ 356 Điều 18, 19).
>
> Theo docs/DATA_PROTECTION.md mục 2: **Mẫu 09 là bắt buộc**. Mẫu 10 có thể được miễn theo Luật 91 Điều 38 — chờ luật sư.
> Phần [ngoặc vuông] cần điền. Số liệu ở đây là tại 28/11/2026.

---

## PHẦN A — Mẫu 10

### I. Thông tin cơ bản của bên nộp hồ sơ
1. Tên (tiếng Việt): [ ]; tên viết tắt: Local Growth OS; MST: [ ]
2. Địa chỉ trụ sở: [ ]
3. Điện thoại: [ ]
4. Lĩnh vực kinh doanh có xử lý DLCN: phần mềm dịch vụ (SaaS) và dịch vụ tối ưu hồ sơ doanh nghiệp trên Google Maps.
   Mã ngành: [6201 Lập trình máy vi tính / 6312 Cổng thông tin / 7310 Quảng cáo — chọn theo đăng ký kinh doanh]
5. Số chi nhánh / VPĐD: [0]
6. Email: [ ]
7. Website: [domain]
8. Bộ phận / nhân sự BVDLCN (8.3 nội bộ): [Họ tên, chức vụ, điện thoại, email] — kèm quyết định phân công.

### II. Hoạt động xử lý dữ liệu cá nhân
**1. Vai trò**
- ☑ 1.1 Bên kiểm soát và xử lý:
  - người dùng đăng ký (chủ doanh nghiệp, nhân viên agency) — số lượng: [đếm `auth.users`];
  - người để lại thông tin dùng thử / tư vấn — [đếm `demo_leads` + `consultation_requests`].
- ☑ 1.2 Bên xử lý (cho khách hàng doanh nghiệp):
  - người viết review trên hồ sơ Google của khách — [đếm `client_reviews` có `author_name`];
  - người liên hệ của khách — [đếm `clients.contact_name`].
- ☐ 1.3 Bên thứ ba.

**2. Luồng xử lý (sơ đồ)**
```
Người dùng ──(đăng ký, đồng ý)──> Ứng dụng web (Vercel, Mỹ) ──> CSDL Supabase (Singapore)
                                     │
                                     ├─> Anthropic (Mỹ): phân tích hồ sơ, soạn nội dung / phản hồi
                                     ├─> Resend (Mỹ): email nhắc việc, biên nhận
                                     ├─> Outscraper / SerpApi / SearchApi (Mỹ): đọc hồ sơ + review công khai trên Google Maps
                                     ├─> Google Places API / Business Profile API (Mỹ)
                                     ├─> Make (EU/Mỹ) ──> Google Business Profile: đăng bài, phản hồi review
                                     ├─> DataForSEO (Estonia): thứ hạng theo lưới vị trí
SePay (VN) ──(webhook giao dịch)──────┘
```

**3. Loại dữ liệu**
- 3.1 Cơ bản (NĐ 356 Điều 3), tích:
  - ☑ họ tên;
  - ☑ số điện thoại;
  - ☑ địa chỉ liên hệ (địa chỉ doanh nghiệp, có thể là nhà riêng của hộ kinh doanh);
  - ☑ hình ảnh của cá nhân (ảnh do khách tải lên, ảnh đại diện Google);
  - ☑ thông tin tài khoản số (email, tài khoản đăng nhập);
  - ☑ thông tin khác giúp xác định cá nhân (tên hiển thị người viết review, IP, trình duyệt).
- 3.2 Nhạy cảm (Điều 4): ☐ không chủ đích.
  - ⚠️ Cân nhắc tích "dữ liệu về lịch sử giao dịch tài khoản ngân hàng" nếu luật sư cho rằng nội dung / tên người chuyển
    trong webhook SePay thuộc loại này.
  - Toạ độ trong hệ thống là của **doanh nghiệp**, không phải vị trí cá nhân.

**4. Sự đồng ý**
- Trang đăng ký có 3 ô, không đánh dấu sẵn:
  - (1) Điều khoản + xử lý để cung cấp dịch vụ — bắt buộc;
  - (2) chuyển dữ liệu ra nước ngoài — bắt buộc;
  - (3) email ưu đãi — tuỳ chọn.
- Lưu trong bảng `consent_records`: phiên bản chính sách, mục đích, thời điểm, IP, trình duyệt.
- Người dùng cũ / đổi phiên bản → hộp xác nhận lại.
- Rút lại: trong Cài đặt (tuỳ chọn) hoặc yêu cầu xoá tài khoản (bắt buộc).
- Kèm ảnh chụp màn hình trang đăng ký và `/privacy`.

**5. Lưu trữ:** bảng hạn lưu trữ trong docs/DATA_PROTECTION.md mục 4, và `/privacy` mục 6.

**6. Xoá, huỷ:**
- Xoá tài khoản tự phục vụ: chờ 7 ngày để huỷ, xoá trong ≤ 20 ngày.
- Dọn dữ liệu quá hạn hằng ngày (`run_privacy_retention`).
- Chứng từ thanh toán giữ 10 năm.

**7. Chuyển giao (Luật 91 Điều 17):** ☐ Có / ☑ Không; có thu phí: ☑ Không.

**8. Sàn dữ liệu:** ☑ Không.

**9. Kinh doanh dịch vụ xử lý DLCN:** ⚠️ [☐ Có / ☐ Không — theo ý kiến luật sư; xem các dịch vụ "phần mềm tự động thay mặt
bên kiểm soát", "thu thập trực tuyến từ trang web", "xử lý tự động dựa trên AI"].

**10. Chuyển xuyên biên giới:** ☑ Có (xem Phần B).

**11. Biện pháp bảo vệ**
- 11.1 Phương án an toàn:
  - HTTPS / TLS;
  - Supabase mã hoá dữ liệu khi lưu (AES-256 theo tài liệu nhà cung cấp — cần kiểm tra);
  - sao lưu tự động của Supabase;
  - khoá service role chỉ ở máy chủ;
  - cron có CRON_SECRET;
  - webhook có HMAC.
- 11.2 Biện pháp:
  - Row Level Security theo workspace;
  - cột bí mật chỉ service_role đọc được;
  - token Google mã hoá;
  - không lưu payload thô của nhà cung cấp dữ liệu;
  - tối thiểu hoá tên người viết review;
  - nhật ký thao tác nhân viên (`agency_actions`, chỉ ghi thêm);
  - phân quyền superadmin.
- 11.3 Kiểm tra:
  - Supabase security advisors mỗi lần migration;
  - `pnpm audit` / cập nhật bản vá (ví dụ Next.js 16.4.5, 28/11/2026);
  - [đặt lịch rà soát quý].

**12. Đánh giá tuân thủ:** tự đánh giá theo checklist docs/DATA_PROTECTION.md mục 3, ngày [ ].

### III. Đánh giá tác động
**1. Tổng quan:**
- Cần xử lý DLCN để cung cấp tài khoản, thanh toán, và phản hồi review thay chủ doanh nghiệp.
- Quy mô nhỏ (< 1.000 chủ thể, cập nhật số thật).
- Rủi ro chính:
  - lộ dữ liệu do lỗi cấu hình;
  - nhà cung cấp nước ngoài;
  - thu thập dữ liệu công khai qua bên thứ ba;
  - nội dung AI sai.

**2.1 Tác động đến chủ thể**

| Vấn đề | Mục tiêu | Biện pháp đã có | Đề xuất |
|---|---|---|---|
| Tên người viết review bị lưu lâu, dùng ngoài mục đích | Chỉ dùng để trả lời review | Không lưu ảnh / link hồ sơ; xoá tên sau 90–365 ngày; không xuất ra ngoài | Ưu tiên nguồn Business Profile API |
| Người dùng không rõ dữ liệu đi đâu | Minh bạch | `/privacy` liệt kê từng bên, quốc gia, mục đích, lưu trữ | Gửi email khi đổi bên xử lý |
| Khó thực hiện quyền | Thực hiện nhanh | Xuất JSON tức thì; xoá tự phục vụ; xác nhận tự động | Mẫu email cho yêu cầu chỉnh sửa / phản đối |
| Nội dung AI trả lời review sai / xúc phạm | Không gây hại cho người viết | Kiểm tra nội dung trước khi đăng; chế độ duyệt | Danh sách từ cấm |

**2.2 An ninh hệ thống:**
- Rủi ro: lộ service role key, lỗi RLS, lỗ hổng framework.
- Biện pháp: khoá chỉ ở biến môi trường máy chủ, RLS + test, cập nhật bản vá, advisors.
- Đề xuất: xoay vòng khoá định kỳ; bật 2FA cho tài khoản Supabase / Vercel / GitHub.

**2.3 An ninh quốc gia:** không áp dụng (dưới 100.000 chủ thể cơ bản và dưới 10.000 chủ thể nhạy cảm).

### IV. Phụ lục kèm
- Chính sách bảo mật (`/privacy`)
- Điều khoản (`/terms`)
- Ảnh màn hình đồng ý
- Quy trình sự cố (DATA_PROTECTION.md mục 6)
- Mẫu phụ lục xử lý dữ liệu (`phu-luc-xu-ly-du-lieu.md`)
- Quyết định phân công nhân sự BVDLCN

### PHẦN B (Mẫu 10) — Các bên liên quan
- Bên kiểm soát (khi ta là bên xử lý): khách hàng gói Làm hộ (theo hợp đồng).
- Bên xử lý: xem bảng dưới.

---

## PHẦN B — Nội dung riêng cho Mẫu 09 (chuyển xuyên biên giới)

**II.1 Hình thức:** Luật 91 Điều 20.1.c — sử dụng nền tảng ngoài lãnh thổ Việt Nam để xử lý dữ liệu thu thập tại Việt Nam.
(Cả 20.1.b với nhà cung cấp AI / email.)

**II.2 Luồng:** như sơ đồ ở trên. Dữ liệu gửi đi cho từng bên:
- Supabase: toàn bộ;
- Anthropic: nội dung doanh nghiệp và review, không có email / mật khẩu;
- Resend: email, tên, nội dung email;
- scraper: tên / link doanh nghiệp;
- Make: nội dung bài / phản hồi.

**II.9.4 / III.3 Bên nhận — đánh giá mức bảo vệ**

| Bên nhận | Pháp nhân / quốc gia | Cách xử lý, lưu trữ | Biện pháp của bên nhận (theo tài liệu công khai — cần kiểm tra, kèm DPA) |
|---|---|---|---|
| Supabase | Supabase Inc. (Mỹ); máy chủ AWS ap-southeast-1 Singapore | CSDL Postgres, Auth, Storage | SOC 2 Type II, mã hoá khi lưu / truyền, DPA |
| Vercel | Vercel Inc. (Mỹ) | Chạy hàm máy chủ, log | SOC 2, DPA |
| Anthropic | Anthropic PBC (Mỹ) | API xử lý văn bản | Điều khoản thương mại: không huấn luyện trên dữ liệu API; DPA |
| Resend | Mỹ | Gửi email | DPA |
| Google | Google LLC (Mỹ) | Places / Business Profile API, OAuth | Điều khoản GMP / Google Cloud DPA |
| Outscraper | Bee Cave, Texas, Mỹ | Trả dữ liệu công khai | Chính sách bảo mật công khai (không có DPA chuẩn — ⚠️) |
| SerpApi | SerpApi, LLC, Austin, Texas, Mỹ | Trả dữ liệu công khai | ⚠️ kiểm tra DPA |
| SearchApi | SearchApi, LLC, New York, Mỹ | Trả dữ liệu công khai | Có DPA công bố (searchapi.io/legal/dpa) |
| DataForSEO | DataForSEO OÜ, Estonia (EU; vận hành Ukraine) | Thứ hạng | GDPR, DPA, SCC |
| Make | Celonis / Make, Cộng hoà Séc; vùng EU / Mỹ | Kịch bản tự động | GDPR, DPA |

**III.2 Tác động:**
- Rủi ro: cơ quan nước ngoài truy cập dữ liệu; nhà cung cấp bị sự cố; khó thực thi quyền xuyên biên giới.
- Giảm thiểu: chỉ chuyển dữ liệu cần thiết; mã hoá; hợp đồng / DPA; có thể xoá theo yêu cầu.
- Đề xuất: cân nhắc chọn vùng Vercel gần (Singapore `sin1`) và vùng Make EU.
