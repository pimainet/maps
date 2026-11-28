# Bảo vệ dữ liệu cá nhân (BVDLCN) — nghĩa vụ, đã làm, việc chủ doanh nghiệp phải làm

Cập nhật 28/11/2026. **Không phải tư vấn pháp lý.** Những điểm đánh dấu ⚠️ là diễn giải chưa chắc chắn, nên hỏi luật sư.

Trạng thái kỹ thuật: code xong, **migration `033_data_protection.sql` CHƯA chạy trên DB thật** (đã test trên Postgres 17 tạm).
Trước khi chạy 033, mọi tính năng mới tự bỏ qua: không chặn người dùng, cron không lỗi.

---

## 1. Căn cứ pháp lý (nguồn chính thức)

| Văn bản | Hiệu lực | Nguồn |
|---|---|---|
| Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 | 01/01/2026 | [thuvienphapluat](https://thuvienphapluat.vn/van-ban/Bo-may-hanh-chinh/Luat-Bao-ve-du-lieu-ca-nhan-2025-so-91-2025-QH15-625628.aspx) · [Bộ Công an](https://mps.gov.vn/chinh-sach-phap-luat/co-so-du-lieu-van-ban/luat-bao-ve-du-lieu-ca-nhan-1753688803) |
| Nghị định 356/2025/NĐ-CP (hướng dẫn Luật 91; **thay Nghị định 13/2023**, Điều 42) | 01/01/2026 | [Công báo](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-356-2025-nd-cp-468371.htm) · [PDF](https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/17/356signed-1768638052103952849513.pdf) |
| Nghị định 330/2026/NĐ-CP (xử phạt VPHC về BVDLCN) | 19/08/2026 | [PDF Công báo](https://congbaocdn.chinhphu.vn/180507251028987904/2026/9/4/470339-1787824085_v1_1788483945_signed.pdf) |
| Luật Thương mại điện tử 122/2025/QH15 | 01/07/2026 | [Công báo](https://congbao.chinhphu.vn/van-ban/luat-so-122-2025-qh15-468683.htm) |
| Nghị định 248/2026/NĐ-CP (hướng dẫn Luật TMĐT; thay hệ thống NĐ 52/2013 + 85/2021) | 01/07/2026 | [Công báo](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-248-2026-nd-cp-469983.htm) · [MOIT](https://moit.gov.vn/tin-tuc/bo-cong-thuong-pho-bien-luat-thuong-mai-dien-tu-va-nghi-dinh-so-248-2026-nd-cp.html) |
| Luật Kế toán 2015 Điều 41; Nghị định 174/2016/NĐ-CP Điều 12–13 | — | [MOF](https://vbpq.mof.gov.vn/DKC.FileManagement/FileStorage/File/47433) · [Công báo](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-174-2016-nd-cp-21879.htm) |
| Google Maps Platform Service Specific Terms; Places API policies | — | [Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) · [Policies](https://developers.google.com/maps/documentation/places/web-service/policies) |
| Business Profile APIs policies (cập nhật 28/08/2026) | — | [Policies](https://developers.google.com/my-business/content/policies) |
| Google Terms of Service; Google Maps Additional Terms | — | [ToS](https://policies.google.com/terms) · [Maps terms](https://maps.google.com/help/terms_maps/) |

### Khác biệt chính so với Nghị định 13/2023
- Có **Luật** (cấp cao hơn) + **chế tài riêng** (NĐ 330/2026), phạt tới 5% doanh thu năm trước (chuyển dữ liệu xuyên biên giới) hoặc 3 tỷ đồng (vi phạm khác), mức cho tổ chức; cá nhân bằng ½ (NĐ 330 Điều 7.4).
- Hồ sơ DPIA / chuyển xuyên biên giới nộp trong **60 ngày** kể từ lần xử lý / chuyển đầu tiên (Luật 91 Điều 20.2, 21), mẫu mới (NĐ 356 Mẫu 09, 10, 01a/b, 02a/b), cập nhật **6 tháng/lần** (Điều 22; NĐ 356 Điều 20, mẫu 03a/b).
- **Miễn** DPIA, cập nhật hồ sơ, nhân sự BVDLCN cho hộ kinh doanh / doanh nghiệp siêu nhỏ, và cho doanh nghiệp nhỏ / khởi nghiệp được chọn trong 5 năm (đến 31/12/2030) — **trừ** đơn vị kinh doanh dịch vụ xử lý DLCN, trực tiếp xử lý DLCN nhạy cảm, hoặc đạt ≥ 100.000 chủ thể (Luật 91 Điều 38.2–38.3; NĐ 356 Điều 41). **Không miễn hồ sơ chuyển dữ liệu xuyên biên giới (Điều 20).**
- Đồng ý cũ / hồ sơ đã nộp theo NĐ 13 vẫn có giá trị (Luật 91 Điều 39).
- Danh mục dữ liệu nhạy cảm mở rộng (NĐ 356 Điều 4), gồm: vị trí xác định qua dịch vụ định vị; thông tin thẻ, lịch sử giao dịch tại tổ chức tín dụng / trung gian thanh toán; dữ liệu theo dõi hành vi sử dụng dịch vụ trên không gian mạng.

## 2. Phân tích cho Local Growth OS

**Vai trò.**
- Với người dùng (chủ quán, agency), chúng ta là **bên kiểm soát và xử lý**.
- Với dữ liệu khách hàng của họ (người viết review, ghi chú, gói Làm hộ), chúng ta là **bên xử lý**, hoặc ⚠️ đồng kiểm soát với phần dữ liệu tự thu thập từ Google Maps.

**Chuyển dữ liệu xuyên biên giới: CÓ.** Dữ liệu thu thập tại Việt Nam được xử lý trên nền tảng ngoài lãnh thổ: Supabase Singapore, Vercel / Anthropic / Resend Hoa Kỳ (Luật 91 Điều 20.1.c).
- → Bắt buộc **hồ sơ đánh giá tác động chuyển DLCN xuyên biên giới** (Mẫu 09 + thông báo Mẫu 01a), nộp A05 trong 60 ngày kể từ lần chuyển đầu tiên.
- Nghĩa vụ này không được miễn cho doanh nghiệp nhỏ.
- Ngoại lệ NĐ 356 Điều 17.3 (báo chí, khẩn cấp, nhân sự, thanh toán / vận tải…) **không** áp dụng cho SaaS.
- Phạt nếu không lập / không nộp: 30–50 triệu đồng (NĐ 330 Điều 56).

**DPIA (Mẫu 10).**
- Nếu là hộ kinh doanh / DN siêu nhỏ / DN nhỏ: được miễn hoặc được chọn không làm (đến 2030), **trừ khi bị coi là "kinh doanh dịch vụ xử lý DLCN"**.
- ⚠️ NĐ 356 Điều 21 liệt kê các dịch vụ: "cung cấp và vận hành hệ thống, phần mềm tự động để thay mặt bên kiểm soát xử lý DLCN", "phân tích, khai thác DLCN", "thu thập, xử lý DLCN trực tuyến từ trang web, ứng dụng, mạng xã hội", "xử lý DLCN tự động dựa trên dữ liệu lớn, AI". Các dịch vụ này là ngành nghề có điều kiện:
  - Điều 22: pháp nhân Việt Nam, ≥ 3 nhân sự đủ chuẩn, đã nộp DPIA, có giấy chứng nhận;
  - phạt khi kinh doanh không có giấy chứng nhận: 50–80 triệu đồng (NĐ 330 Điều 59.3.a).
- Mục đích chính của sản phẩm là quản lý hồ sơ doanh nghiệp (dữ liệu tổ chức), không phải xử lý DLCN, nên nhiều khả năng không thuộc nhóm này. Tuy vậy, hộp thư review (tên người viết + nội dung) và gói Làm hộ có thể bị diễn giải khác. **Cần luật sư xác nhận.** Bản nháp DPIA đã soạn sẵn ở `docs/legal/dpia-draft.md` để dùng nếu cần.

**Số chủ thể.** Hiện rất nhỏ (DB thật 28/11/2026: 11 doanh nghiệp, 1 thành viên workspace), cách xa ngưỡng 100.000 (NĐ 356 Điều 41).

**Dữ liệu nhạy cảm.**
- Không chủ đích thu thập.
- ⚠️ `bank_transactions` (tên / số tài khoản người chuyển, nội dung chuyển khoản do SePay gửi về) **có thể** bị coi là "lịch sử giao dịch" (NĐ 356 Điều 4) dù chúng ta không phải tổ chức tín dụng. Cách hiểu thận trọng: hạn chế quyền truy cập (đang chỉ superadmin) và không dùng cho mục đích khác.

**Thu thập từ Google Maps qua scraper (Outscraper / SerpApi / SearchApi).**
- Luật / pháp lý:
  - NĐ 330 Điều 48 phạt **thu thập DLCN bằng phương tiện kỹ thuật trái phép** 100–800 triệu đồng tuỳ số chủ thể.
  - Tên hiển thị người viết review là DLCN. Thu thập để chủ quán trả lời review của chính quán họ có căn cứ hợp lý hơn (dữ liệu đã công khai; Luật 91 Điều 16, 19), nhưng ⚠️ chưa có hướng dẫn rõ về "dữ liệu công khai".
  - → Đã giảm thiểu: không lưu payload thô, không lưu ảnh / link hồ sơ người viết, xoá tên sau 90–365 ngày.
- Điều khoản Google:
  - Google ToS cấm "using automated means to access content … in violation of the machine-readable instructions"; Maps Additional Terms cấm "mass download or create bulk feeds of the content".
  - Rủi ro chủ yếu thuộc nhà cung cấp scraper, nhưng có thể ảnh hưởng tài khoản Google / API của chúng ta.
  - Vụ Google LLC v. SerpApi, LLC (N.D. Cal. 4:25-cv-10826-YGR, [hồ sơ toà](https://cand.uscourts.gov/cases-e-filing/cases/425-cv-10826-ygr/google-llc-v-serpapi-llc)): theo nguồn thứ cấp, đơn sửa đổi bị bác ngày 09/11/2026 và Google còn hạn nộp lại đến 10/12/2026. ⚠️ Chưa đọc trực tiếp lệnh toà.
- **Khuyến nghị:** ưu tiên dữ liệu từ Business Profile API (khách đã kết nối) cho hộp thư review; dùng scraper chủ yếu cho audit lần đầu.

**Google Places API (chính thức).**
- Chỉ được lưu `place_id` lâu dài (nên làm mới nếu quá 12 tháng).
- lat/lng tối đa **30 ngày liên tục**.
- Các nội dung khác (tên, địa chỉ, review, ảnh) **không được pre-fetch, cache hay lưu** ([Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)).
- Code hiện gộp dữ liệu Places vào `gbp_snapshots` (`lib/gbp-places.ts` → `mergeWithPlaces`). Đã giảm thiểu: bỏ payload thô, review trong snapshot sống 30 ngày, snapshot cũ xoá sau 90 ngày, toạ độ Places xoá sau 30 ngày.
- ⚠️ **Rủi ro còn lại:** các trường hồ sơ (tên, địa chỉ, điểm sao, giờ mở cửa) lấy từ Places vẫn nằm trong snapshot mới nhất quá 30 ngày; `rank_grid_configs.center_lat/lng` có thể bắt nguồn từ Places. Hướng xử lý triệt để:
  - (a) chỉ dùng Places làm nguồn dự phòng hiển thị tức thời, không lưu; hoặc
  - (b) ghi provenance từng trường và xoá trường nguồn Places sau 30 ngày.
  - Chưa làm vì ảnh hưởng audit / so sánh trước-sau → cần quyết định sản phẩm.

**Business Profile API.**
- Nội dung API chỉ được lưu tạm **≤ 30 ngày**, an toàn, không tổng hợp ("Content storage").
- Phải có uỷ quyền của chủ quán trước khi trả lời review / đăng bài.
- Phải thông báo cho chủ quán trong 48 giờ khi công cụ thay đổi tài khoản của họ.
- Khi khách ngừng dùng: **7 ngày làm việc** để trả lại toàn quyền và gỡ quyền truy cập.
- Không được ngụ ý là đối tác Google.
- ⚠️ Review lấy qua Business Profile API được lưu trong `client_reviews` lâu hơn 30 ngày (review_text). Diễn giải: đây là dữ liệu của chính khách hàng, dùng trong project của chúng ta (phần "for use outside of your Business Profile project" mới bị cấm). Vẫn nên xác nhận.

**Thương mại điện tử.**
- Trang /billing cho phép chọn gói và thanh toán (giao kết hợp đồng điện tử), nên nhiều khả năng là "nền tảng TMĐT kinh doanh trực tiếp có chức năng đặt hàng trực tuyến".
- → Phải được **UBND cấp tỉnh xác nhận thông báo trước khi vận hành** (Luật 122 Điều 14.1; NĐ 248 Điều 23–24, Mẫu 01 Phụ lục II, nộp qua Cổng dịch vụ công).
- Phải công khai: thông tin chủ quản, chính sách bảo mật, quyền và nghĩa vụ, cách giải quyết khiếu nại, giá, thanh toán, chấm dứt và hoàn tiền; có cơ chế đồng ý trước khi mở tài khoản (Luật 122 Điều 11).
- ⚠️ Chưa có hướng dẫn riêng cho SaaS B2B.

**Kế toán.** Chứng từ dùng trực tiếp ghi sổ, sổ kế toán, báo cáo tài chính: ≥ 10 năm; chứng từ khác: ≥ 5 năm (NĐ 174/2016 Điều 12–13). → Giữ `payments`, `bank_transactions`, `billing_events` 10 năm, kể cả khi người dùng xoá tài khoản (FK `ON DELETE SET NULL` đã tách khỏi tài khoản).

## 3. Checklist nghĩa vụ

| # | Nghĩa vụ | Căn cứ | Trạng thái |
|---|---|---|---|
| 1 | Thông báo xử lý (loại dữ liệu, mục đích, bên kiểm soát, quyền) trước khi thu thập | Luật 91 Đ9.2, Đ11 | ✅ `/privacy` (cần điền thông tin doanh nghiệp) |
| 2 | Đồng ý theo **từng mục đích**, không ô đánh dấu sẵn, không ép mục đích phụ | Luật 91 Đ9.4; NĐ 356 Đ6 | ✅ 3 ô ở `/signup` (2 bắt buộc + 1 tuỳ chọn) |
| 3 | Lưu bằng chứng đồng ý kiểm chứng được (ai, khi nào, nội dung) | NĐ 356 Đ6; phạt 30–50tr NĐ 330 Đ43 | ✅ `consent_records` (phiên bản, mục đích, thời điểm, IP, UA) — sau khi chạy 033 |
| 4 | Người dùng cũ / chính sách đổi phiên bản → xin đồng ý lại | Luật 91 Đ9 | ✅ `ConsentGate` trong dashboard |
| 5 | Rút lại đồng ý bằng văn bản (kể cả điện tử) | Luật 91 Đ10 | ✅ tuỳ chọn marketing trong Cài đặt; bắt buộc → yêu cầu xoá |
| 6 | Quyền xem / được cung cấp (10 ngày) | NĐ 356 Đ5 | ✅ "Tải dữ liệu của tôi" (JSON, trả ngay) |
| 7 | Quyền xoá (20 ngày) | Luật 91 Đ14; NĐ 356 Đ5 | ✅ yêu cầu xoá → chờ 7 ngày (huỷ được) → cron xoá |
| 8 | Xác nhận đã nhận yêu cầu trong 2 ngày làm việc; có quy trình / biểu mẫu | NĐ 356 Đ5; phạt 10–20tr NĐ 330 Đ44 | ✅ tự động (acknowledged_at); ⚠️ yêu cầu qua email phải xử lý tay |
| 9 | Chỉnh sửa / hạn chế / phản đối | Luật 91 Đ4 | 🟡 qua email; bảng `data_requests` có sẵn loại yêu cầu |
| 10 | Tối thiểu hoá, giới hạn lưu trữ | Luật 91 Đ3 | ✅ `run_privacy_retention()` hằng ngày (mục 4) |
| 11 | Hợp đồng với bên xử lý (DPA) | Luật 91 Đ37 | 🟡 dùng DPA chuẩn của nhà cung cấp (người dùng phải chấp nhận / lưu bản) |
| 12 | Hợp đồng gói Làm hộ có điều khoản xử lý dữ liệu | Luật 91 Đ37.1.a, 37.2.a | ✅ mẫu `docs/legal/phu-luc-xu-ly-du-lieu.md` |
| 13 | **Hồ sơ đánh giá tác động chuyển DLCN xuyên biên giới** (Mẫu 09 + 01a), nộp trong 60 ngày | Luật 91 Đ20; NĐ 356 Đ18 | ❌ **CHỦ DOANH NGHIỆP PHẢI LÀM** (bản nháp nội dung trong `dpia-draft.md` phần B) |
| 14 | DPIA (Mẫu 10 + 02a), 60 ngày | Luật 91 Đ21; NĐ 356 Đ19 | ⚠️ có thể được miễn (Đ38) — bản nháp sẵn |
| 15 | Cập nhật hồ sơ 6 tháng/lần | Luật 91 Đ22 | ❌ đặt lịch nhắc sau khi nộp |
| 16 | Nhân sự / bộ phận BVDLCN | Luật 91 Đ33.2 | ⚠️ có thể được miễn; vẫn nên chỉ định 1 người (điền ở /privacy) |
| 17 | Thông báo vi phạm cho A05 trong **72 giờ** + lập biên bản | Luật 91 Đ23; NĐ 356 Đ28 (Mẫu 08); phạt 40–60tr NĐ 330 Đ54 | ❌ quy trình mục 6 — cần người trực |
| 18 | Mã hoá dữ liệu trên cloud khi lưu và truyền; kiểm soát truy cập | NĐ 356 Đ12 | ✅ Supabase / Vercel mã hoá; RLS; token Google mã hoá |
| 19 | Công khai thông tin chủ quản + điều khoản (TMĐT) | Luật 122 Đ11 | ✅ `/terms` (còn placeholder thuế, hoàn tiền) |
| 20 | Thông báo nền tảng TMĐT bán hàng | Luật 122 Đ14; NĐ 248 Đ23 | ❌ **CHỦ DOANH NGHIỆP PHẢI LÀM** |
| 21 | Không lưu nội dung Google Places ngoài place_id; lat/lng ≤ 30 ngày | GMP terms | 🟡 xem mục 2 (rủi ro còn lại) |
| 22 | Thông báo / thu thập trên landing page (form `demo_leads`) | Luật 91 Đ9 | ❌ landing ở repo khác — thêm câu đồng ý + link /privacy |

## 4. Đã xây dựng (code)

| Thành phần | File |
|---|---|
| Chính sách, mục đích đồng ý, thời hạn, placeholder doanh nghiệp | `lib/privacy/policy.ts`, `lib/privacy/processors.ts` |
| Trang công khai | `app/privacy/page.tsx`, `app/terms/page.tsx`, `components/legal/legal-page.tsx`; `proxy.ts` mở `/privacy`, `/terms` |
| Ô đồng ý ở đăng ký (không đánh dấu sẵn; nút Google / email chỉ bật khi đủ mục bắt buộc) | `app/signup/page.tsx`, `components/legal/consent-checklist.tsx` |
| Ghi đồng ý (cookie tạm 2 ngày / metadata signUp → `consent_records`) | `app/api/consent/route.ts`, `components/legal/consent-gate.tsx` |
| Cài đặt → Dữ liệu & quyền riêng tư (`/settings?tab=privacy`) | `components/legal/privacy-settings.tsx` |
| Xuất dữ liệu JSON | `app/api/account/export/route.ts`, `lib/privacy/export.ts` |
| Yêu cầu xoá / huỷ; thực thi trong cron | `app/api/account/delete-request/route.ts`, `lib/privacy/server.ts` (`executeDueDeletions`) |
| Dọn dữ liệu quá hạn (gộp vào `/api/cron/billing` 01:30 UTC hằng ngày — Vercel Hobby giới hạn cron) | `lib/privacy/server.ts` (`runRetention`) → SQL `run_privacy_retention()` |
| Không lưu payload thô snapshot | `lib/gbp-snapshot-service.ts` (`minimizeSnapshotRaw`) |
| Không điền lại tên người viết review đã xoá | `lib/reviews/ingest.ts` |
| Nguồn toạ độ (Places → xoá sau 30 ngày) | `lib/rankgrid/identity.ts`, `app/api/rankgrid/route.ts` |
| Test | `scripts/test-privacy.ts` (trong `test:logic`) |

### Hạn lưu trữ (`run_privacy_retention`)
| Dữ liệu | Quy tắc |
|---|---|
| `gbp_snapshots.raw_json` | Chỉ giữ `source, source_used, coverage, reply_field_present, raw_review_count, deep` |
| `gbp_snapshots.reviews` | Xoá nội dung sau 30 ngày (giữ thống kê) |
| `gbp_snapshots` cũ | Xoá sau 90 ngày, giữ bản ok/partial mới nhất mỗi doanh nghiệp |
| `clients.latitude/longitude` nguồn `places` | Xoá sau 30 ngày (tự lấy lại khi cần) |
| `client_reviews.author_name` | Xoá 90 ngày sau khi xử lý xong (posted / manual_copied / ignored / replied_elsewhere), hoặc sau 365 ngày |
| `demo_leads` | IP thô xoá sau 30 ngày; xoá lead sau 730 ngày |
| `consultation_requests` won / lost | Ẩn danh sau 730 ngày |
| `ai_classification_cache` | 30 ngày |
| Nhật ký kỹ thuật (`autopost_log`, `review_reply_log`, `review_draft_events`, `ai_usage_events`, `audit_quota_events`) | 365 ngày |
| `consent_records` của tài khoản đã xoá; `data_requests` đã đóng | 5 năm (lựa chọn nội bộ — bằng chứng tuân thủ) |
| `payments`, `bank_transactions`, `billing_events`, `subscriptions` | **Không tự xoá** (≥ 10 năm, kế toán) |
| `agency_actions` | Không xoá (append-only; ⚠️ xem xét giới hạn sau) |

### Xoá tài khoản làm gì
1. Người dùng gõ "XOA TAI KHOAN".
2. Hệ thống tạo `data_requests` với trạng thái `scheduled`, hạn 20 ngày, thực hiện sau 7 ngày.
3. Nếu người dùng là chủ sở hữu duy nhất của workspace còn thành viên khác: chặn, yêu cầu chuyển quyền trước.
4. Cron xử lý:
   - xoá file ảnh trong Storage;
   - xoá workspace chỉ có mình họ (cascade: doanh nghiệp, review, ảnh, kết nối Google, kế hoạch…);
   - rời workspace dùng chung;
   - gọi `privacy_scrub_user()` (ẩn danh yêu cầu tư vấn; bỏ IP / UA khỏi bằng chứng đồng ý);
   - gọi `auth.admin.deleteUser` (xoá profiles, notification_prefs; payments.user_id → NULL).
5. Lỗi bất kỳ → trạng thái `needs_attention` để superadmin xử lý.
6. ⚠️ Chưa thu hồi token Google tại Google (`oauth2.googleapis.com/revoke`), mới xoá token phía ta. Nên bổ sung.

## 5. Việc CHỦ DOANH NGHIỆP phải làm

1. **Chạy migration 033.** Sau đó chạy thử một lần `select public.run_privacy_retention();` và xem kết quả.
2. **Điền thông tin pháp lý** trên Vercel, rồi redeploy:
   - `NEXT_PUBLIC_LEGAL_NAME`
   - `NEXT_PUBLIC_LEGAL_TAX_ID`
   - `NEXT_PUBLIC_LEGAL_ADDRESS`
   - `NEXT_PUBLIC_LEGAL_EMAIL`
   - `NEXT_PUBLIC_LEGAL_PHONE`
   - `NEXT_PUBLIC_LEGAL_REPRESENTATIVE`
   - Chưa điền thì `/privacy` và `/terms` hiện cảnh báo "Bản nháp".
3. **Chốt chính sách hoàn tiền và cách ghi thuế** trong `app/terms/page.tsx` (đang là placeholder).
4. **Nộp hồ sơ đánh giá tác động chuyển DLCN xuyên biên giới** (Mẫu 09 + Mẫu 01a) cho Cục A05 qua cổng BVDLCN quốc gia.
   - Hạn: 60 ngày kể từ lần chuyển đầu tiên. Nếu đã hoạt động từ trước 01/01/2026, ⚠️ nên nộp càng sớm càng tốt.
   - Nội dung soạn sẵn: `docs/legal/dpia-draft.md`.
5. **Hỏi luật sư:**
   - (a) sản phẩm có bị coi là "kinh doanh dịch vụ xử lý DLCN" (NĐ 356 Điều 21) không → quyết định DPIA và giấy chứng nhận;
   - (b) việc lấy review qua scraper;
   - (c) tư cách hộ kinh doanh / DN siêu nhỏ / nhỏ.
6. **Thông báo nền tảng TMĐT bán hàng** (Mẫu 01 NĐ 248) qua Cổng dịch vụ công trước khi tiếp tục bán gói qua /billing; gắn biểu tượng xác nhận khi được cấp.
7. **Chấp nhận / lưu DPA** của Supabase, Vercel, Anthropic, Resend, Make, DataForSEO, SerpApi, SearchApi, Outscraper (bản DPA / terms của từng bên); kiểm tra vùng chạy Vercel và vùng tài khoản Make.
8. **Chỉ định người phụ trách BVDLCN và người trực sự cố 72 giờ**; in quy trình ở mục 6.
9. **Landing page:** thêm dòng "Bằng việc gửi, bạn đồng ý với Chính sách bảo mật" và link `/privacy` vào form để lại số Zalo.
10. Dùng `docs/legal/phu-luc-xu-ly-du-lieu.md` cho mọi hợp đồng gói Làm hộ.
11. Đặt lịch rà soát 6 tháng/lần (cập nhật hồ sơ theo Điều 22 nếu đã nộp).

## 6. Quy trình sự cố (72 giờ)

1. **Phát hiện:** cảnh báo Supabase / Vercel, báo cáo của người dùng, log bất thường. Ghi thời điểm phát hiện; đồng hồ 72 giờ bắt đầu từ lúc này.
2. **Ngăn chặn:** thu hồi khoá (Supabase service role, CRON_SECRET, API keys), khoá tài khoản bị lộ, vá lỗi.
3. **Đánh giá:**
   - loại dữ liệu và số chủ thể bị ảnh hưởng;
   - khả năng gây hại tới tính mạng, sức khoẻ, danh dự, tài sản;
   - nếu có → bắt buộc thông báo.
4. **Thông báo A05** theo Mẫu 08 (NĐ 356 Điều 28) **≤ 72 giờ**. Lập **biên bản** sự cố (Luật 91 Điều 23.2).
5. **Thông báo người dùng bị ảnh hưởng** khi cần (email qua Resend), kèm khuyến nghị (đổi mật khẩu…).
6. **Sau sự cố:** báo cáo nguyên nhân, biện pháp; lưu hồ sơ.
