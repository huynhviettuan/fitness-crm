# Flow Fitness — Khung sườn định hướng xây dựng phần mềm

> Customer document received 2026-10-15 (`Flow Fitness_Khung sườn định hướng phần mềm quản lý.docx`), transcribed as text. Reviewed in `docs/32_CUSTOMER_INPUT_2026-10-15.md`.

Mục đích tài liệu: Chia sẻ  bức tranh cấu trúc tổng thể và định hướng quản trị mà Flow Fitness mong muốn xây dựng.

Thông điệp: Flow không chỉ cần nơi lưu thông tin khách hàng; Flow muốn quản trị xuyên suốt hành trình từ Lead đến khách mua, sử dụng dịch vụ, tái mua và hiệu quả kinh doanh.

## Bức tranh tổng thể mong muốn

| Lớp hệ thống | Vai trò chính | Kết quả |
|---|---|---|
| 1. Marketing & Lead Generation | Tập hợp và đo lường nguồn khách | Lead đến từ đâu, chiến dịch nào hiệu quả, chi phí tạo khách |
| 2. CRM & Sales Pipeline | Quản lý khách và quá trình chuyển đổi | Ai phụ trách, đã xử lý đến đâu, bước tiếp theo là gì, vì sao mất khách |
| 3. Assessment | Quản lý lịch và kết quả đánh giá | Khách đã đến chưa, kết quả đánh giá, mục tiêu và lộ trình |
| 4. PT & Membership | Quản lý gói tập và cung cấp dịch vụ | Sản phẩm đã bán, số buổi đã dùng/còn lại, lịch Coach, gia hạn |
| 5. Customer Care & Retention | Chăm sóc và giữ chân khách | Khách cần chăm sóc, có nguy cơ ngừng tập, khi nào cần gia hạn |
| 6. Finance & Reconciliation | Theo dõi giao dịch và đối soát | Giá trị bán, tiền thực thu, công nợ, doanh thu ghi nhận |
| 7. Management Dashboard | Tổng hợp cho CEO/Operations | Doanh thu, chuyển đổi, hiệu quả nhân sự, vận hành và cảnh báo |

## Hành trình khách hàng cần được liên thông

| Giai đoạn | Dữ liệu / hành động cần lưu | Câu hỏi quản trị |
|---|---|---|
| Thu hút | Nguồn, chiến dịch, thời điểm Lead, thông tin liên hệ | Nguồn nào mang lại khách tiềm năng tốt? |
| Tư vấn | Người phụ trách, thời gian phản hồi, lịch sử liên hệ, nhu cầu | Lead có được phản hồi đúng hạn không? |
| Đặt Assessment | Ngày giờ, xác nhận, đổi/hủy, người thực hiện | Bao nhiêu khách đặt và thực sự đến? |
| Assessment | Kết quả, mục tiêu, khuyến nghị, báo cáo khách hàng | Khách có được đánh giá và tư vấn đầy đủ không? |
| Bán pakage | Gói đề xuất, giá, giảm giá, giao dịch, lý do Show/No Show | Tỷ lệ chuyển đổi và giá trị bán là bao nhiêu? |
| Coach | Lịch tập, Coach, buổi hoàn thành, số buổi còn lại | Dịch vụ có được thực hiện đúng và đủ không? |
| Chăm sóc/gia hạn | Tần suất tập, phản hồi, cảnh báo, lịch follow-up | Khách nào cần giữ chân hoặc gia hạn? |
| Tài chính | Thanh toán, công nợ, refund, dữ liệu đối soát | Tiền đã thu và nghĩa vụ dịch vụ còn lại là gì? |

## Các module chính cần được xem xét

| Module | Định hướng chức năng |
|---|---|
| CRM & Customer 360 | Một mã khách hàng; chống trùng; hồ sơ, nhu cầu, nguồn, lịch sử tư vấn và mọi tương tác. |
| Lead & Sales Pipeline | Các giai đoạn chuyển đổi có thể cấu hình; phân công; SLA; follow-up; lý do Lost; lịch sử thay đổi. |
| Marketing Tracking | Nguồn/chiến dịch, chi phí, số Lead, Assessment, khách mua, doanh thu và CAC/ROAS theo định nghĩa thống nhất. |
| Assessment | Booking, trạng thái đến/không đến, kết quả theo chỉ số và đơn vị, báo cáo khách hàng, so sánh các lần đánh giá. |
| PT & Membership | Danh mục gói, hợp đồng, lịch Coach, trạng thái buổi tập, số buổi đã dùng/còn lại, gia hạn. |
| Customer Service | Danh sách khách cần chăm sóc, khách giảm tần suất, sắp hết buổi/hết hạn, khiếu nại và kết quả xử lý. |
| Finance | Giao dịch, thanh toán, công nợ, giảm giá, hoàn tiền, đối soát và xuất dữ liệu cho kế toán. |
| Dashboard & Analytics | KPI theo thời gian, nguồn, nhân viên, Coach, dịch vụ và cơ sở; có khả năng đi từ số tổng đến dữ liệu chi tiết. |
| Automation & Integration | Nhắc lịch, cảnh báo quá hạn, chăm sóc lại, kết nối kênh liên hệ và hệ thống liên quan theo khả năng tích hợp. |
| Security & Admin | Phân quyền, audit log, backup/restore, cấu hình danh mục và bàn giao quyền quản trị. |

## Những nguyên tắc mong muốn

Một khách hàng – một hồ sơ trung tâm: các bộ phận sử dụng chung hồ sơ và lịch sử, hạn chế tạo dữ liệu trùng.

Một lần nhập – nhiều nơi sử dụng: dữ liệu được tái sử dụng cho Sales, Assessment, PT, Finance và Dashboard.

Quản trị theo quy trình: trạng thái, người phụ trách, hạn xử lý và bước tiếp theo phải rõ ràng.

Dữ liệu có thể kiểm tra: thay đổi quan trọng cần lưu người thao tác, thời điểm, giá trị trước/sau và lý do.

KPI có định nghĩa thống nhất: thống nhất công thức, nguồn dữ liệu, thời điểm ghi nhận và bộ lọc.

Cấu hình linh hoạt: danh mục, pipeline, SLA và quy tắc vận hành nên thay đổi được trong giới hạn đã thống nhất.

Bảo mật theo vai trò: nhân sự chỉ truy cập dữ liệu cần cho công việc; dữ liệu Assessment cần kiểm soát riêng.

Flow kiểm soát được dữ liệu: có quyền truy cập, xuất dữ liệu và quy trình bàn giao khi thay đổi nhà cung cấp.

Thiết kế để mở rộng: cân nhắc nhiều cơ sở, nhiều dịch vụ, nhiều vai trò và nhu cầu tích hợp tương lai.

## Dashboard quản trị mong muốn

| Góc nhìn | KPI / thông tin tham khảo |
|---|---|
| Marketing | Leads, CPL, chi phí chiến dịch, Assessment theo nguồn, khách mua và CAC/ROAS |
| Sales | First Response Time, Contact Rate, Booking Rate, Show-up Rate, Conversion Rate, Average Deal Size |
| Customer | Khách mới, khách đang tập, Retention, Renewal, Churn, khách cần chăm sóc |
| PT Operations | Buổi hoàn thành, hủy/vắng, số buổi còn, công suất Coach, lịch trống |
| Finance | Giá trị bán, tiền thực thu, công nợ, refund, doanh thu ghi nhận theo chính sách |
| CEO/Operations | Thực tế so với mục tiêu, xu hướng, GAP, cảnh báo quá hạn và drill-down |

## 6. Phân kỳ triển khai tham khảo

| Giai đoạn | Trọng tâm | Kết quả kỳ vọng |
|---|---|---|
| Phase 1 – Core | CRM, Lead, Sales Pipeline, Follow-up, nguồn khách, báo cáo chuyển đổi | Kiểm soát Lead và hiệu quả chuyển đổi |
| Phase 2 – Operations | Assessment, PT/Membership, lịch, số buổi, thanh toán/công nợ | Liên thông bán hàng với cung cấp dịch vụ và đối soát |
| Phase 3 – Optimize | Automation, tích hợp kênh, retention analytics, Power BI/API | Giảm việc thủ công và nâng cao năng lực phân tích |

## 7. Mong muốn

Đây là tài liệu định hướng cấu trúc sản phẩm ở mức tổng quan.

Đây là cấu trúc quản trị mong muốn, ưu tiên hệ thống liên thông, dễ kiểm soát dữ liệu, dễ mở rộng và có thể đo lường hiệu quả kinh doanh.
