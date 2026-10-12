<!-- Customer brief v2 (detailed), converted from 'Brief CRM Flow Fitness – Bản hoàn chỉnh (1).docx' (first issued 10/10/2026, updated 12/10/2026, @Ka). Source of truth for docs 00–28; cite as brief §n. Do not edit except to replace with a newer brief. -->

# Brief CRM Flow Fitness – Bản hoàn chỉnh

Oct 10, 2026 · @Ka

Tài liệu này giao cho developer xây hệ thống CRM riêng của Flow Fitness, thay GymMaster, gồm 12 phân hệ trong giai đoạn 1. Nó thay thế bản brief trước và gom mọi quyết định đã chốt. Cập nhật ngày 12/10/2026 theo phản hồi báo cáo tiến độ ngày 11/10: hạ tầng email, lịch PT mở toàn thời gian, chia và chuyển lượt lead, khóa checklist, cơ cấu tổ chức, thông báo nhân viên và sẵn sàng tích hợp máy vân tay.

## 1. Tổng quan, phạm vi và nguyên tắc

Flow Fitness cần một hệ thống CRM riêng, quản lý trọn hành trình từ lead đến hợp đồng, buổi tập, thu chi và báo cáo. Đây là phần đầu của một hệ thống ERP lớn hơn, nên kiến trúc phải mở rộng được.

Lý do tự xây: chủ động dữ liệu khách hàng, kiểm soát chi phí dài hạn, không phụ thuộc chính sách nhà cung cấp, và bổ sung những phần GymMaster chưa làm được (quản lý tư vấn, theo dõi kết quả giáo án).

### Tài liệu gửi kèm

| Tài liệu | Dùng cho |
|---|---|
| Sơ đồ hành trình khách hàng (PDF) | Luồng nghiệp vụ tổng thể, mục 3 |
| Bộ ảnh chụp màn hình GymMaster | Tham chiếu logic, trường dữ liệu, bố cục. Không sao chép giao diện, thương hiệu hay mã nguồn |
| Excel "CRM Flow Fitness - MKT" | Logic hành trình tư vấn và kịch bản tư vấn, mục 4. Xóa hoặc ẩn tên và SĐT khách thật trước khi gửi |
| Excel "Flow Workout Log" | Mẫu nhật ký buổi tập, mục 7 |
| Excel "employee_pt_training" (xuất từ GymMaster) | Báo cáo doanh thu phân bổ theo HLV, mục 6 |


### Phạm vi giai đoạn 1

| Phân hệ | Nội dung chính | Mục |
|---|---|---|
| Nền tảng và phân quyền | Người dùng, vai trò, cây quyền tùy biến, chi nhánh | 2 |
| Lead và tư vấn | Thu lead, phân bổ tự động, hành trình tư vấn theo bước, nhắc việc, audit, tái chăm sóc | 4 |
| Khách hàng | Hồ sơ một người xuyên suốt từ lead | 4 |
| Dịch vụ và bậc giá | Dịch vụ, bậc giá theo khoảng số buổi, ưu đãi | 5 |
| Hợp đồng | Đăng ký, duyệt, khóa, tạm vô hiệu, xóa, các nghiệp vụ biến động | 5 |
| Lịch PT | Đặt lịch, check-in, trạng thái buổi, trừ buổi, tính công | 6 |
| Lịch lớp | Lớp nhóm, đăng ký chỗ, điểm danh | 6 |
| Giáo án | Danh mục, template, giáo án của khách, nhật ký buổi tập, Flag, Action, escalation | 7 |
| Sổ quỹ | Phiếu thu, phiếu chi, công nợ, chi trả HLV | 8 |
| Giao việc | Giao và theo dõi công việc trong và liên phòng ban | 8 |
| Email cho khách | Hạ tầng gửi email tự động cho mọi thao tác ảnh hưởng quyền lợi khách; email và thông báo điện thoại cho nhân viên | 8 |
| Dashboard và báo cáo | Tư vấn, giáo án, hợp đồng, session, thu chi | 9 |


Ngoài phạm vi giai đoạn 1: Pro Shop, tủ đồ, khăn tập, hợp đồng Loyalty và tích điểm, thẻ ngày, gắn máy vân tay (giai đoạn 1 xây sẵn dữ liệu, luồng và API theo mục 6.6), app cho hội viên, Zalo OA, kế toán thuế và hóa đơn điện tử, các module ERP khác (bán lẻ, kho, nhân sự - lương). Thiết kế dữ liệu theo module để gắn thêm sau mà không phải viết lại.

### Nguyên tắc thiết kế: luồng cố định, giá trị mở

Hệ thống chỉ cố định logic và luồng đi. Mọi con số, danh mục và quyền đều do admin quản lý trên giao diện, không cần developer sửa mã.

| Cố định trong mã (luồng) | Admin tùy biến (giá trị) |
|---|---|
| Lead → đặt lịch → show → khách hàng → hợp đồng → buổi tập | Kênh, nguồn, nhóm nhu cầu, lý do từ chối |
| Hợp đồng phải duyệt mới kích hoạt; đã duyệt thì khóa | Dịch vụ, bậc giá, khoảng số buổi, đơn giá, thời hạn, ưu đãi |
| Xóa phiếu thu trước khi xóa hợp đồng; dữ liệu xóa vào Thùng rác | Vai trò, cây quyền, ngưỡng duyệt, nghiệp vụ nào cần duyệt |
| Mỗi trạng thái buổi tập có một quy tắc trừ buổi và tính công | Quy tắc của từng trạng thái, màu hiển thị, khung giờ lịch |
| Các bước tư vấn sinh việc có hạn và được audit | Mốc thời gian nhắc, kịch bản tư vấn, tiêu chí chấm |
| Doanh thu HLV = buổi tính công × phân bổ/buổi × tỉ lệ | Tỉ lệ hoa hồng, tỉ lệ chấm công, Flag, Action, loại chi |
| Mọi thay đổi số buổi của khách đều sinh thông báo | Mẫu email, loại sự kiện nào được gửi |


Developer không viết cứng bất kỳ giá trị nào ở cột phải. Các con số xuất hiện trong brief này là giá trị khởi tạo.

Nhập liệu bằng drop-down, không viết tay. Mọi kết quả, trạng thái, phân loại và lý do trong hệ thống đều được chọn từ danh sách do admin thiết lập: kết quả của từng bước tư vấn, các mục checklist, lý do từ chối, lý do xóa, lý do hủy kích hoạt, lý do giá ngoại lệ, Flag, Action, tổng kết buổi tập, loại chi. Admin thêm, sửa, sắp thứ tự và vô hiệu từng lựa chọn trên giao diện; lựa chọn bị vô hiệu vẫn giữ nguyên trên dữ liệu cũ. Mỗi drop-down có sẵn lựa chọn "Khác"; khi chọn "Khác" thì bắt buộc điền tay nội dung mới lưu được. Với các lựa chọn còn lại, ô ghi chú tự do là phần bổ sung tùy chọn, không thay cho lựa chọn. "Chi tiết nhu cầu" của lead cũng được quy hoạch thành danh mục có mã số do admin thiết lập, kèm ô ghi chú. Admin xem được thống kê các nội dung "Khác" để bổ sung thành lựa chọn chính thức. Nhờ vậy báo cáo và audit đếm được chính xác.

Khuôn màn hình danh sách dùng chung: bộ lọc bên trái, ô tìm kiếm, bảng dữ liệu có phân trang và dòng tổng, nút Thêm mới và Xuất Excel.

## 2. Người dùng, vai trò và phân quyền

Mỗi nhân sự chỉ thấy và dùng đúng những phân hệ được cho phép; admin tự quản lý toàn bộ phân quyền trên giao diện. Mô hình học theo màn "Người dùng" của GymMaster.

### Vai trò mặc định khi bàn giao

| Vai trò | Làm gì trong hệ thống | Giới hạn dữ liệu |
|---|---|---|
| Quản trị hệ thống (admin) | Toàn quyền cấu hình, check-in buổi tập, xóa, xem Thùng rác, mọi báo cáo | Tất cả chi nhánh |
| Fitness Manager (quản lý) | Nhận lead mới và escalation, phân bổ lại lead, audit tư vấn, duyệt hợp đồng và giá ngoại lệ, nhận việc "báo Studio" | Chi nhánh được gán |
| Master (coach chính) | Xem và đánh giá giáo án của mọi PT, xử lý escalation, xem dashboard giáo án. Admin giữ vai trò này trước, sau đó cấp cho Studio Manager | Chi nhánh được gán |
| Consulting (tư vấn / sale) | Xử lý lead được phân bổ theo hành trình tư vấn, tạo hợp đồng chờ duyệt | Chỉ lead và khách do mình tạo hoặc phụ trách (cấu hình phạm vi dữ liệu của vai trò, admin đổi được) |
| Huấn luyện viên (PT) | Đặt lịch, soạn giáo án, ghi nhật ký buổi tập, xem báo cáo session của mình | Chỉ khách và lịch của mình |
| Lễ tân | Tạo lead walk-in, đánh dấu show / no show, hỗ trợ đặt lịch, bổ sung thông tin khách | Chi nhánh được gán |
| Marketing | Xem báo cáo lead theo kênh và nguồn | Không xem SĐT, giấy tờ |


Bảy vai trò này là cấu hình khởi tạo, không phải giới hạn của hệ thống.

### Tài khoản người dùng
- Trường: tên tài khoản, họ tên, email, nhân viên gắn với tài khoản, trạng thái hoạt động.
- Trang chi tiết có 4 tab: Thông tin, Phân quyền, Thời gian truy cập, Lịch sử đăng nhập.

### Mô hình phân quyền
- Vai trò: bộ quyền đặt tên; admin tạo mới, sửa và nhân bản được.
- Cây quyền theo phân hệ: quyền chia nhóm theo phân hệ, mỗi mục mở ra các thao tác con (xem, thêm, sửa, xóa, duyệt, xuất) để tích riêng. Các nhóm: Danh mục, Hệ thống, Lead và tư vấn, Khách hàng, Nghiệp vụ hợp đồng, Lịch PT và lịch lớp, Giáo án, Giao việc, Sổ quỹ, Nhân viên, Báo cáo.
- Quyền xem dữ liệu tách khỏi quyền chức năng: xem tất cả hay chỉ xem của mình phụ trách, áp cho lead, hội viên, hợp đồng, lịch PT, phiếu thu chi, nhân viên, lịch sử thao tác; xem nhân viên ở tất cả chi nhánh; xem tổng tiền hợp đồng; xem công nợ hội viên.
- Ẩn trường nhạy cảm theo vai trò: SĐT, email, địa chỉ, giấy tờ của hội viên; tổng tiền danh sách phiếu thu.
- Quyền riêng cho các thao tác nhạy cảm: bấm "Đã tập", Burn Show, xóa buổi tập, xóa hợp đồng, xóa phiếu thu, sửa ngày thu tiền, hủy kích hoạt và kích hoạt lại hợp đồng, duyệt giá ngoại lệ, xem Thùng rác, xuất Excel.
- Quyền báo cáo theo từng báo cáo: mỗi báo cáo và dashboard là một quyền riêng.
- Ngưỡng duyệt là tham số theo vai trò: mức giảm giá tối đa được tự duyệt, vượt mức thì chuyển lên cấp nào; nghiệp vụ nào cần duyệt.
- Chi nhánh: tích chọn những chi nhánh tài khoản được truy cập. Hệ thống đa chi nhánh ngay từ đầu.
- Thời gian truy cập: giới hạn khung giờ và ngày được đăng nhập cho từng tài khoản.
- Lịch sử đăng nhập: thời điểm, thiết bị, địa chỉ IP.
- Quyền riêng cho từng người: tài khoản lấy quyền từ vai trò và có thể được bật tắt thêm từng quyền, để không phải tạo vai trò mang tên cá nhân như trong GymMaster.

### Quy tắc bắt buộc
- Menu và nút không được cấp quyền thì ẩn hẳn; quyền được kiểm tra ở phía server cho mọi yêu cầu, không chỉ ẩn trên giao diện.
- Mọi thao tác tạo, sửa, xóa, duyệt và mọi thay đổi về vai trò, quyền, ngưỡng đều ghi nhật ký: ai, lúc nào, giá trị trước và sau.

### Xét duyệt từ tuyến trên

Thao tác tạo mới, sửa đổi, điều chỉnh của tài khoản nhân viên phải qua bước duyệt của tuyến trên trước khi có hiệu lực. Luồng duyệt là cố định; thao tác nào cần duyệt và ai duyệt do admin cấu hình trong một ma trận duyệt.
- Luồng cố định: nhân viên gửi → bản ghi ở trạng thái Chờ duyệt và chưa có hiệu lực → người duyệt nhận việc trong phân hệ Giao việc → Duyệt hoặc Từ chối (lý do chọn từ drop-down) → ghi nhật ký.
- Ma trận duyệt do admin cấu hình: với mỗi loại thao tác, admin bật hoặc tắt yêu cầu duyệt, chọn vai trò duyệt, và đặt ngưỡng chuyển lên cấp cao hơn.
- Người tạo không tự duyệt thao tác của chính mình, kể cả khi có quyền duyệt.
- Sửa hợp đồng chỉ làm được khi hợp đồng còn Chờ duyệt; sau khi duyệt thì khóa theo mục 5.4.
- Thao tác chờ duyệt quá 24 giờ (chỉnh được) thì nhắc người duyệt và báo quản lý trực tiếp của người duyệt theo tuyến báo cáo; người không có quản lý trực tiếp thì báo Admin.

| Nhóm thao tác | Cần duyệt (khởi tạo) | Người duyệt (khởi tạo) |
|---|---|---|
| Tạo và sửa hợp đồng, giá ngoại lệ | Có | Fitness Manager; vượt ngưỡng thì admin |
| Phiếu biến động: gia hạn, nâng cấp, bảo lưu, chuyển nhượng, chuyển chi nhánh, chuyển đổi, hủy | Có | Fitness Manager |
| Phiếu thu, phiếu chi | Có | Fitness Manager hoặc admin |
| Xóa bất kỳ dữ liệu nghiệp vụ nào; hủy kích hoạt hợp đồng | Có | Admin |
| Sửa thông tin định danh của khách hàng (tên, SĐT, email, giấy tờ). Sửa của lead thì không cần duyệt | Có | Fitness Manager |
| Tạo và sửa giáo án, template | Có | Master |
| Thao tác hằng ngày: nhập lead, tick bước tư vấn, đặt và hủy lịch, ghi nhật ký buổi tập, giao việc | Không | Kiểm soát bằng audit, check-in của admin và nhật ký |


Đã chốt: thao tác hằng ngày không duyệt, kiểm soát bằng lịch sử thao tác và cơ chế khóa checklist (mục 4.1); admin vẫn bật duyệt cho từng loại bất cứ lúc nào.

### Cơ cấu tổ chức và tuyến báo cáo

Phòng ban, chức danh và tuyến báo cáo nhập theo sơ đồ "Cơ cấu tổ chức Flow Group 10/2026 (Ver 2)" gửi kèm. Mỗi nhân viên có trường "Quản lý trực tiếp", dùng để báo khi duyệt chậm và để cấp quản lý giao việc cho cấp dưới.

| Phòng ban | Chức danh | Báo cáo cho |
|---|---|---|
| Ban điều hành | CEO | – |
| Ban điều hành | Trợ lý CEO | CEO |
| Studio | Studio Manager / Master | CEO |
| Studio | Operation Coordinator, Client Care | Studio Manager / Master |
| Studio | Coach Leader | Studio Manager / Master |
| Studio | Coach Advance, Coach Junior, Coach Rookie | Coach Leader |
| Marketing | Marketing Manager | CEO |
| Marketing | Content / Branding; Content Creator / Ads Performance; Media; Growth / Performance | Marketing Manager |
| Marketing | Content Creator / Branding (Flow Fitness, Flow Store); Media (Flow Fitness, Flow Store) | Trưởng nhóm tương ứng |
| Marketing | Direct Sale / Online Flow Fitness; Sale Flow Store | Growth / Performance |
| Finance | Kế toán trưởng | CEO |
| Finance | Kế toán Flow Fitness, Kế toán Flow Store | Kế toán trưởng |
| Finance | Dòng tiền Store, Kho | Kế toán Flow Store |

- Chức danh và vai trò là hai thứ riêng: chức danh là vị trí trong sơ đồ, vai trò là bộ quyền. Ghép khởi tạo: CEO → Quản trị hệ thống; Studio Manager / Master → Fitness Manager; Coach các cấp → Huấn luyện viên; Operation Coordinator, Client Care → Lễ tân; Direct Sale / Online Flow Fitness → Consulting; nhóm Marketing → Marketing; Kế toán → Kế toán.
- Giao việc: mọi nhân viên giao được việc cho đồng nghiệp cùng phòng ban và cho phòng ban khác; cấp quản lý giao được cho cấp dưới. Admin chỉnh được trong phân quyền.
- Agency là đơn vị ngoài, chưa tạo tài khoản. Chức danh Flow Store được nhập sẵn cho module bán lẻ sau này, chưa cần tài khoản.
- Quy mô 12 tháng tới: 2 chi nhánh, 20 – 30 tài khoản nhân viên.

## 3. Hành trình khách hàng

Một người đi qua 4 giai đoạn và chỉ có một hồ sơ xuyên suốt: Lead ID được chuyển thành Customer ID khi khách đến phòng tập, không tạo bản ghi mới.

| Giai đoạn | Việc xảy ra | Dữ liệu thu thêm | Ai thao tác |
|---|---|---|---|
| 1. Trước khi đến phòng tập (Lead) | Lead vào từ kênh digital, walk-in hoặc kênh cộng tác. Hệ thống gắn kênh, phân lượt cho người tư vấn, báo quản lý. Người tư vấn làm theo hành trình tư vấn. | Mã lead, kênh, nguồn, người phụ trách, họ tên, nhu cầu, trạng thái | Hệ thống, Tư vấn |
| 2. Xác nhận hẹn | Tư vấn thành công, khách đặt lịch đến. | SĐT, email, tình trạng sức khỏe cơ bản, loại Assessment, ngày giờ hẹn, ghi chú | Tư vấn, Lễ tân |
| 3. Khi đến phòng tập | Lễ tân đánh dấu Show hoặc No show. Show thì lead thành khách hàng; không Show thì chuyển về lại Lead để tái chăm sóc. | Customer ID, CCCD / Passport, ngày sinh, quốc tịch | Lễ tân, Tư vấn |
| 4. Đăng ký dịch vụ và sau đăng ký | Tạo hợp đồng, quản lý duyệt, thu tiền, PT đặt lịch và ghi nhật ký buổi tập, hệ thống trả báo cáo. | Chi nhánh, dịch vụ, thanh toán, ưu đãi, lịch và buổi tập | Tư vấn, Quản lý, PT, Admin |


### Trạng thái của lead
- Mới - vừa vào hệ thống, chưa có người phụ trách.
- Đang tư vấn - đã phân bổ, người tư vấn đang trao đổi với khách.
- Cân nhắc - khách đã nhận tư vấn, chưa quyết định.
- Chưa phản hồi - khách im lặng; hệ thống chạy chuỗi nhắc.
- Đã đặt lịch - có ngày giờ hẹn đến phòng tập.
- Show - khách đã đến; chuyển thành Customer.
- No show - khách không đến đúng hẹn; chuyển vào tái chăm sóc.
- Từ chối - khách từ chối, bắt buộc chọn lý do; chuyển vào tái chăm sóc.
- Đã ký hợp đồng - có ít nhất một hợp đồng được duyệt.

Năm trạng thái 2, 3, 4, 5, 8 giữ đúng cột "Booking Status" trong file Excel tư vấn đang dùng.

### Quy tắc luồng
- Lead Từ chối, Chưa phản hồi và No show không bị đóng. Chúng vào hàng đợi tái chăm sóc, có ngày nhắc liên hệ lại, và có thể quay về Đang tư vấn hoặc Đã đặt lịch.
- Mỗi lần đổi trạng thái và mỗi bước tư vấn đều lưu thời điểm và người thực hiện, để đo tỷ lệ chuyển đổi và audit từng bước.
- Khách Show nhưng chưa ký hợp đồng vẫn là Customer và tiếp tục được theo dõi.
- Trùng số điện thoại: hệ thống cảnh báo và đề nghị gộp, không tự tạo hồ sơ thứ hai.

## 4. Lead, hành trình tư vấn và khách hàng

### 4.1 Lead và hành trình tư vấn

Phân hệ này thay file Excel "CRM Flow Fitness - MKT" đang nhập tay, giữ nguyên logic của file và bổ sung ba thứ Excel không làm được: nhắc việc tự động, audit, dashboard.

Thu và phân bổ lead
- Nguồn vào: tin nhắn từ các kênh qua API hoặc webhook; walk-in và các kênh chưa tích hợp nhập tay bằng form nhanh.
- Tách hai khái niệm: Kênh liên hệ (khách nhắn qua đâu) và Nguồn lead (khách biết Flow từ đâu), kèm phân loại Organic / Paid và chi tiết nguồn.
- Phân bổ tự động: chia lượt xoay vòng có tỷ trọng. Mỗi tư vấn viên có hệ số lượt do admin đặt (khởi tạo 1); ví dụ full-time hệ số 2, part-time hệ số 1 thì trong mỗi vòng 3 lead, người full-time nhận 2. Chỉ chia cho người đang trong giờ làm và đang bật nhận lead; admin tạm tắt nhận lead cho từng người. Bộ quy tắc chia thiết kế để sau này thêm điều kiện theo kênh hoặc ngôn ngữ. Quản lý vẫn phân bổ lại được bằng tay.
- Thông báo: quản lý nhận thông báo khi có lead mới; người tư vấn nhận thông báo khi được gán.
- Trường bắt buộc khi tạo lead: họ tên và kênh liên hệ. Số điện thoại bổ sung sau, vì nhiều khách nhắn qua mạng xã hội chưa để lại số. Chặn trùng chỉ chạy khi có SĐT; khi trùng, tư vấn viên mở được hồ sơ cũ để chăm sóc tiếp theo quyền được cấp.
- Tự động chuyển lượt: lead không được chăm sóc (bước đầu tiên chưa hoàn thành) trong 1 giờ thì chuyển sang tư vấn viên kế tiếp theo quy tắc chia lượt. Chỉ tính giờ trong khung làm việc của tư vấn, khởi tạo 08:30 – 20:30; ngoài khung lead chờ, không bị chuyển. Ví dụ lead vào lúc 20:00 còn 30 phút đến 20:30, sáng hôm sau chạy tiếp 30 phút còn lại từ 08:30. Thời hạn và khung giờ là tham số admin chỉnh được.
- Lưu vết chuyển lượt: mỗi lần tự chuyển ghi lead nào, từ ai sang ai, lúc nào, đã chờ bao lâu. Người cũ nhận thông báo. Dashboard tư vấn đếm số lần bị chuyển lượt của từng người để đánh giá mức độ sát sao.

Hồ sơ lead

| Nhóm | Trường | Giá trị chọn (khởi tạo) |
|---|---|---|
| Cơ bản | Ngày, người phụ trách (PIC), họ tên, giới tính, ngày sinh, SĐT, email | Giới tính: Nam, Nữ |
| Kênh liên hệ | Kênh khách nhắn đến | WhatsApp, Messenger, Zalo, Gọi điện, Instagram, Threads, TikTok, Gmail, Khách tự tìm đến Flow |
| Nguồn lead | Nguồn, phân loại, chi tiết nguồn | Website, Fanpage, Google Ads, Instagram, Threads, TikTok, Người quen, ChatGPT, Google Maps; Organic / Paid |
| Quốc tịch | Quốc gia (danh sách các nước theo chuẩn ISO 3166); nhóm Việt Nam / Nước ngoài và ngôn ngữ email tự suy ra | Việt Nam, Nước ngoài |
| Nhu cầu | Nhóm nhu cầu, chi tiết nhu cầu (văn bản) | 1 - Body Transformation; 2 - Pain Relief & Better Movement; 3 - Energy, Longevity & Performance; 4 - Group Class; Khác |
| Phân loại cơn đau | Pain Status | No; 2.1 (Coach); 2.2 (Expert) |
| Assessment | Loại buổi đánh giá được mời | Physical Assessment, Pain Assessment |
| Đặt lịch | Trạng thái, thời gian hẹn | Đang tư vấn, Cân nhắc, Chưa phản hồi, Đã đặt lịch, Từ chối |
| Kết quả | Show / No show, ghi chú | Show, No show |


Hành trình tư vấn theo bước

Mỗi lead có một checklist các bước. Hệ thống tự tạo việc cần làm kèm hạn cho người phụ trách, và ghi lại ai hoàn thành, lúc nào.

| Bước | Khi nào hệ thống tạo việc | Kết quả cần chọn (drop-down) |
|---|---|---|
| 1. Tư vấn sản phẩm phù hợp | Ngay khi lead được phân bổ | Nhóm nhu cầu, chi tiết nhu cầu, Pain Status, loại Assessment |
| 2. Nhắc lần 1 | 60 phút sau khi khách chưa phản hồi | Đã nhắc |
| 3. Nhắc lần 2 | 24 giờ sau khi khách chưa phản hồi | Đã nhắc |
| 4. Đặt lịch | Khi khách đồng ý hẹn | Ngày giờ hẹn; trạng thái sang Đã đặt lịch |
| 5. Nhắc trước hẹn lần 1 | 3 giờ trước giờ hẹn | Khách xác nhận / Không phản hồi |
| 6. Báo Studio lần 1 | Ngay sau bước 5 | Tạo việc cho coach Manager trong phân hệ Giao việc |
| 7. Nhắc trước hẹn lần 2 | 60 phút trước giờ hẹn | Khách xác nhận / Không phản hồi |
| 8. Báo Studio lần 2 | Ngay sau bước 7 | Cập nhật việc đã giao cho coach Manager |
| 9. Ghi nhận Show / No show | Đến giờ hẹn | Show thì chuyển thành khách hàng |
| 10. Tái chăm sóc | 15 ngày sau, với lead Chưa phản hồi, Từ chối, No show | Đặt lịch / Từ chối; nếu đặt lịch thì ghi tiếp Show / No show |

- Các mốc thời gian (60 phút, 24 giờ, 3 giờ, 15 ngày) là tham số admin chỉnh được.
- "Báo Studio" là thông báo tự động đến coach Manager qua phân hệ Giao việc (mục 8.2), nơi giao tiếp công việc liên phòng ban và trong phòng ban.
- Gợi ý mời Assessment cho người tư vấn: khách tập được từ 3 tuần (20 buổi) trở lên thì miễn phí Fitness Assessment; dưới 20 ngày thì giảm 50%. Đây là giá trị khởi tạo.
- Kết quả mỗi bước là drop-down: người tư vấn chọn kết quả từ danh sách đã thiết lập cho bước đó, không gõ tay. Giá trị khởi tạo lấy từ file Excel: "Done" cho các bước tư vấn và nhắc; "Khách xác nhận / Không phản hồi" cho nhắc trước hẹn; "Show / No show"; "Đặt lịch / Từ chối" cho tái chăm sóc.
- Admin tùy biến cả checklist: thêm, bớt, đổi tên, sắp lại các bước; đặt mốc thời gian và danh sách kết quả cho từng bước; đánh dấu bước nào bắt buộc. Thay đổi chỉ áp dụng cho lead mới, lead đang chạy giữ checklist cũ.
- Ngày giờ hẹn chọn bằng ô lịch; ghi chú là ô văn bản tùy chọn đi kèm, không thay cho kết quả.
- Khóa checklist để hành trình phản ánh đúng thực tế: đã tick thì không bỏ tick được, tick nhầm chỉ admin gỡ kèm lý do. Quá hạn mà chưa tick thì trong khoảng gia hạn (admin đặt) vẫn tick được nhưng ghi "Trễ"; hết gia hạn thì bước tự khóa ở trạng thái "Không thực hiện", không ai tick bù được. Thời điểm tick do hệ thống ghi.
- Mục đích của checklist là đo quy trình, không phải phạt nhân viên. Thiếu bước không có nghĩa là tư vấn viên không hoàn thành nhiệm vụ. Dashboard cho thấy tỷ lệ thực hiện từng bước và tương quan giữa việc làm bước đó với tỷ lệ đặt lịch, show, ký hợp đồng, để biết bước nào dư thừa, bước nào thiếu, rồi chỉnh quy trình.
- AI hỗ trợ checklist (M11): khi nội dung chat đã vào hệ thống, AI đọc hội thoại và đề xuất các bước đã làm với khách; tư vấn viên xác nhận.

Thư viện kịch bản tư vấn
- Chuyển sheet "Framework tư vấn chung" thành thư viện mẫu câu trả lời theo tình huống, song ngữ Việt - Anh, quản lý sửa được.
- Người tư vấn mở lead, chọn tình huống, bấm sao chép để dán vào kênh chat. Tình huống hiện có: chào lần đầu, hỏi mục tiêu, khách có cơn đau, mời Assessment, giá Hybrid, giá Therapy, NKT, lớp nhóm, membership, thanh toán, nhắc lịch, kết thúc tư vấn.

Audit hành trình tư vấn
- Audit tự động theo quy tắc: mỗi bước có trạng thái đúng hạn, trễ hạn, bỏ qua. Hệ thống chấm tỷ lệ tuân thủ cho từng lead và từng nhân sự, và gắn cờ lead thiếu trường bắt buộc (nhu cầu, SĐT, lý do từ chối).
- Audit của quản lý: quản lý mở một lead, xem dòng thời gian đầy đủ, chấm đạt / chưa đạt và để lại nhận xét.
- AI hỗ trợ audit: AI đọc ghi chú và nội dung hội thoại của lead, đối chiếu với kịch bản, rồi đề xuất điểm và các lỗi thường gặp (chưa hỏi mục tiêu, chưa hỏi thời gian lưu trú, chưa mời Assessment, báo giá sai). Quản lý quyết định cuối. Phần này chỉ làm được đầy đủ khi nội dung chat đã vào hệ thống qua tích hợp kênh, nên xếp ở mốc cuối; developer đề xuất phương án và chi phí.

Màn hình làm việc
- Danh sách và bảng Kanban theo trạng thái; trang chi tiết lead có checklist bước, dòng thời gian, ghi chú, lịch hẹn.
- "Việc hôm nay" của từng người tư vấn: các bước đến hạn và quá hạn.
- Danh sách tái chăm sóc, sắp theo ngày cần liên hệ lại.
- Nút "Chuyển thành khách hàng" khi Show, yêu cầu nhập đủ CCCD / Passport, ngày sinh, quốc gia và email. CCCD / Passport chỉ bắt buộc sau khi phần mã hóa dữ liệu nhạy cảm hoàn thành; trước đó trường này khóa và không lưu.

### 4.2 Khách hàng
- Hồ sơ: mã khách, họ tên, SĐT, email (bắt buộc), ngày sinh, giới tính, quốc tịch, giấy tờ, địa chỉ, sức khỏe cơ bản, nhóm khách hàng, kênh liên hệ, nguồn lead, người liên hệ khẩn cấp, nhân viên phụ trách, chi nhánh, ghi chú.
- Trạng thái suy ra từ hợp đồng: đang tập, sắp hết hạn, hết hạn, bảo lưu, chưa có hợp đồng.
- Bộ lọc: chi nhánh, nhân viên phụ trách, ngày đăng ký, sinh nhật, ngày hết hạn tập, trạng thái.
- Trang chi tiết có các tab: Thông tin khách hàng, Hợp đồng và dịch vụ, Lịch sử thanh toán, Giáo án, Nhật ký buổi tập và tiến độ, Lịch sử tư vấn (từ lead), Email đã gửi.
- Điểm phải khác GymMaster: trong GymMaster, giáo án đã tạo không hiện trong hồ sơ hội viên và không theo dõi được kết quả. Ở hệ thống mới, mọi giáo án và mọi buổi tập của khách phải xem được ngay trong hồ sơ của khách đó.

## 5. Dịch vụ, bậc giá và hợp đồng

### 5.1 Dịch vụ và bậc giá

Bảng giá dựa trên dịch vụ và bậc giá theo khoảng số buổi, không dựa trên danh sách gói cố định. Cách này thay cho việc đang làm trong GymMaster: chọn gói gần nhất rồi dùng quyền admin sửa số buổi và số tiền, khiến tên gói và số buổi thực lệch nhau.
- Dịch vụ: tên, ảnh, loại (PT, Theo lớp, Member), chi nhánh áp dụng, khung giờ được tập, tỉ lệ hoa hồng, gói nhóm và số hội viên tối đa, giới hạn số buổi mỗi tuần và mỗi ngày, hiệu lực, ghi chú. Ví dụ: Hybrid Training, Hybrid Family, NKT, Group Training.
- Bậc giá của từng dịch vụ: mỗi bậc gồm khoảng số buổi (từ - đến), đơn giá mỗi buổi, thời hạn sử dụng tính bằng số tháng và số ngày. Chỉ admin sửa được; mỗi lần sửa lưu phiên bản và ngày hiệu lực, hợp đồng cũ giữ giá lúc ký.
- Thời hạn tự tính: ngày kết thúc của hợp đồng bằng ngày bắt đầu cộng thời hạn của bậc. Ví dụ bậc 12 buổi có thời hạn 2 tháng thì hết hạn sau 2 tháng.
- Gói chọn nhanh: các mốc hay bán hiện thành nút bấm; chúng chỉ là lối tắt điền sẵn số buổi.
- Số buổi bất kỳ: người tạo hợp đồng nhập số buổi, hệ thống tự tra bậc và tính đơn giá, tổng tiền, ngày hết hạn. Không ai nhập tay đơn giá.
- Tên hiển thị tự sinh từ dịch vụ và số buổi thực, ví dụ "Hybrid Training 30 buổi", nên tên và số buổi luôn trùng nhau.
- Giá ngoại lệ (trường hợp phụ): khi giá thỏa thuận khác bậc giá, hoặc có giảm giá nhập tay ngoài chương trình khuyến mãi và voucher, người tạo nhập giá đề nghị kèm lý do bắt buộc. Hợp đồng gắn nhãn "Giá ngoại lệ" và phải được duyệt; hệ thống lưu cả giá theo bậc và giá được duyệt để tính mức chênh.
- Buổi tặng và khuyến mãi thời gian: số buổi, số tháng, số ngày khuyến mãi là trường riêng, tách khỏi phần mua.
- Chương trình ưu đãi và voucher: giảm theo phần trăm hoặc số tiền, có thời gian áp dụng; áp lên giá theo bậc và không tính là giá ngoại lệ.

### 5.2 Tạo và duyệt hợp đồng
- Đăng ký: người tư vấn tạo hợp đồng theo Customer ID. Hợp đồng ở trạng thái Chờ duyệt.
- Duyệt: tài khoản có quyền duyệt chấp nhận hoặc từ chối kèm lý do. Chỉ hợp đồng đã duyệt mới được kích hoạt và đặt lịch.
- Loại hợp đồng: New, Renew.
- Trạng thái hợp đồng: Chờ duyệt, Còn hạn, Tạm vô hiệu, Bảo lưu, Hết hạn, Đã hủy.

Form tạo hợp đồng

| Nhóm | Trường |
|---|---|
| Dịch vụ | Chi nhánh, ngày hợp đồng, mã hợp đồng (tự sinh), loại dịch vụ, dịch vụ, loại hợp đồng, người đi cùng, ghi chú dịch vụ |
| Thời lượng | Số buổi, số tháng, số ngày; hạn kích hoạt, ngày bắt đầu, ngày bắt đầu dự kiến, ngày kết thúc (tự tính); nối tiếp gói tập (hợp đồng trước đó khi tái ký) |
| Phụ trách | Nhân viên PT và nhân viên Sale, mỗi bên thêm được nhiều người kèm tỉ lệ phần trăm, tổng bằng 100% |
| Ký hợp đồng | Đã ký, ngày ký, người ký, ghi chú |
| Giá | Đơn giá dịch vụ (tự tính từ bậc giá), chương trình khuyến mãi hoặc voucher, giảm giá theo % hoặc theo tiền, tổng giảm giá, thuế VAT % và thành tiền, khuyến mãi tháng, ngày, buổi |
| Thu tiền | Số tiền thanh toán lần đầu (tạo phiếu thu), nhân viên sale của phiếu thu, thời hạn thanh toán phần còn lại |


### 5.3 Danh sách và trang chi tiết hợp đồng
- Danh sách: mỗi dòng hiện khách (mã, tên, SĐT), mã và ngày hợp đồng, chi nhánh, loại, dịch vụ, trạng thái, đơn giá mỗi buổi, tổng tiền, đã thanh toán, còn nợ, ngày bắt đầu, kết thúc, hết hạn, tổng buổi, đã tập, còn lại. Đầu trang có tổng tiền, đã thanh toán, công nợ theo bộ lọc.
- Bộ lọc: chi nhánh, loại hợp đồng, ngày hợp đồng, dịch vụ, PT, chương trình khuyến mãi, trạng thái thanh toán, trạng thái ký, trạng thái duyệt.
- Tab Thông tin: toàn bộ trường của hợp đồng.
- Tab Lịch sử check-in: mọi buổi đã tính vào hợp đồng: ngày, giờ, trạng thái, khung giờ, PT, hình thức xác nhận (admin bấm tay, thêm tay, hoặc thiết bị), ghi chú.
- Tab Lịch sử gói tập: các phiếu biến động, lần khóa mở và thay đổi của hợp đồng theo thời gian.
- Thao tác: Thanh toán (tạo phiếu thu), In, Cập nhật ghi chú, Hủy kích hoạt, Hủy duyệt, Xóa. Mỗi thao tác là một quyền riêng.
- Không làm ba nút của GymMaster: "Cập nhật" (sửa trực tiếp hợp đồng đã duyệt), "Cập nhật số buổi đã tập" (gõ tay số buổi) và "Chi trả tiền cọc". Ô "Gói tự do" được thay bằng cơ chế bậc giá ở mục 5.1.

### 5.4 Khóa sau duyệt và xóa hợp đồng sai
- Khóa sau duyệt: hợp đồng đã duyệt không sửa trực tiếp được, kể cả với admin. Khách muốn đổi gói thì đi qua phiếu Gia hạn hoặc Nâng cấp. Hợp đồng nhập sai thì xóa kèm lý do và tạo hợp đồng khác.
- Phải xóa phiếu thu trước (học theo GymMaster): hệ thống chặn xóa hợp đồng khi còn phiếu thu gắn với nó và liệt kê các phiếu cần xử lý. Thứ tự bắt buộc là xóa phiếu thu, rồi mới xóa hợp đồng, để tiền đã ghi nhận và hợp đồng luôn khớp nhau.
- Chặn tương tự với dữ liệu phụ thuộc khác: hợp đồng còn buổi tập đã ghi nhận hoặc phiếu biến động thì chưa xóa được.
- Xóa là xóa có dấu vết: dữ liệu bị xóa rời khỏi danh sách, báo cáo và doanh thu, nhân viên không thao tác được nữa, và được lưu vĩnh viễn trong Thùng rác (mục 8.5). Mã đã xóa không cấp lại.

### 5.5 Hủy kích hoạt (tạm vô hiệu)
- Dùng khi cần khóa tạm một hợp đồng để xem xét (nghi sai phạm, tranh chấp, chờ xác minh) rồi mở lại sau. Hợp đồng vẫn nằm trong danh sách và giữ nguyên dữ liệu.
- Khi tạm vô hiệu: không đặt lịch mới, không check-in, không burn được; các lịch đã đặt trong tương lai được làm nổi để admin xử lý; hợp đồng không tự chuyển sang Hết hạn.
- Bắt buộc nhập lý do khi hủy kích hoạt và khi kích hoạt lại.
- Cộng hạn nửa tự động khi kích hoạt lại: hệ thống tự tính số ngày đã khóa và hiện hộp xác nhận với hạn cũ và hạn mới đề xuất. Admin chọn cộng đủ, sửa số ngày, hoặc không cộng, và ghi lý do. Ví dụ: hạn 04/01/2027, khóa từ 01/11 đến 11/11 thì đề xuất hạn mới 14/01/2027.
- Hạn chỉ thay đổi một lần tại lúc kích hoạt lại; mỗi lần khóa là một bản ghi riêng và chỉ được cộng một lần.
- Hợp đồng khóa quá 10 ngày thì hệ thống tự tạo việc nhắc quản lý.

### 5.6 Nghiệp vụ biến động

Mỗi loại là một phiếu riêng gắn với hợp đồng gốc; nghiệp vụ nào cần duyệt là cấu hình của admin.

| Nghiệp vụ | Tác động | Trường riêng |
|---|---|---|
| Gia hạn | Cộng thêm tháng, ngày hoặc buổi | Từ ngày, đến ngày, số tháng, số ngày, số buổi, tổng tiền |
| Nâng cấp | Đổi lên gói cao hơn | Hợp đồng cũ, gói nâng cấp, giá trị gói mới |
| Bảo lưu | Tạm dừng theo yêu cầu của khách, lùi ngày hết hạn | Từ ngày, đến ngày, số ngày bảo lưu |
| Chuyển nhượng | Chuyển phần còn lại cho khách khác | Số ngày và buổi còn lại, khách nhận |
| Chuyển chi nhánh | Đổi chi nhánh sử dụng | Giá trị chuyển, phí chuyển |
| Chuyển đổi | Đổi sang dịch vụ hoặc loại hợp đồng khác | Hợp đồng cũ, hợp đồng mới, dịch vụ mới |
| Hủy | Chấm dứt hợp đồng theo yêu cầu của khách | Đã thanh toán, giá trị đã dùng, phí hủy, tiền hoàn (tạo phiếu chi) |


## 6. Lịch PT, lịch lớp và buổi tập

Lịch là nơi ghi nhận buổi dạy của HLV, trừ buổi trên hợp đồng của khách và sinh ra doanh thu của từng HLV, nên là phần lõi của giai đoạn 1.

### 6.1 Lưới lịch PT
- Lưới theo ngày: mỗi PT một hàng, ô 30 phút, khung giờ khởi tạo 05:00 - 22:00 (admin chỉnh được). Có nút lùi ngày, Hôm nay, tới ngày, và chế độ xem tuần.
- Bộ lọc: chi nhánh, ngày, huấn luyện viên, khách hàng.
- Nền ô: tô màu phân biệt giờ trong ca trực và ngoài ca trực của từng PT, và thời gian đã qua. Ca làm việc là ca trực, không phải giới hạn đặt lịch: mọi PT, kể cả PT mới chưa có ca, đặt được lịch ở toàn bộ khung giờ của lưới, vì PT thường dạy ngoài giờ trực. PT có sẵn được đặt ca trực khởi tạo 05:00 – 22:00 mỗi ngày; PT mới chưa có ca cho đến khi quản lý nhập. Báo cáo đếm số buổi dạy trong ca và ngoài ca của từng PT.
- Số trong ngoặc cạnh tên PT là số lịch của PT đó trong ngày.
- Đặt lịch: PT hoặc lễ tân chọn khách, hợp đồng còn buổi, giờ bắt đầu, thời lượng. Hệ thống chặn trùng lịch của PT và của khách, chặn hợp đồng chưa duyệt, hết buổi, hết hạn hoặc đang Tạm vô hiệu.
- PT thao tác chủ yếu trên điện thoại, nên màn hình này phải dùng tốt trên mobile.

### 6.2 Chi tiết lịch tập và trạng thái buổi

Bấm vào một ô lịch mở hộp "Chi tiết lịch tập": huấn luyện viên, hội viên (mã, tên, SĐT), gói tập (mã hợp đồng, dịch vụ), giờ bắt đầu, giờ kết thúc, trạng thái, ghi chú, và các nút thao tác.

| Nút | Khi nào dùng | Trạng thái sau đó | Trừ buổi của khách | Tính công cho PT | Màu trên lưới |
|---|---|---|---|---|---|
| (tạo lịch) | Lịch đã book, chưa diễn ra | Đặt lịch | Không | Không | Đỏ |
| Đã tập | Xác nhận buổi tập đã diễn ra | Đã tập | Có | Có | Xanh dương |
| Hủy lịch | Khách báo bận trước với PT | Hủy lịch | Không | Không | Tím |
| Khách không đến | Khách đã đặt lịch nhưng không đến | Khách không đến | Có | Có | Vàng |
| Xóa | Lịch bị book nhầm thời gian | Biến mất khỏi lưới, vào Thùng rác | Không | Không | Không hiển thị |
| Đóng | Đóng hộp chi tiết | Không đổi |  |  |  |

- Admin check-in trong giai đoạn 1: nút "Đã tập" là quyền riêng, mặc định chỉ cấp cho quản trị. Trong GymMaster, buổi tập được xác nhận tự động khi khách check-in vân tay; giai đoạn 1 chưa tích hợp máy vân tay nên admin xác nhận mọi buổi. Màn hình cần cho admin xác nhận nhanh nhiều buổi trong ngày, và thiết kế để sau này nhận check-in tự động từ thiết bị mà không đổi luồng.
- Buổi Đã tập bị khóa: không đổi trạng thái được nữa. Muốn sửa sai chỉ có cách xóa buổi trong Lịch sử check-in của hợp đồng (mục 6.3).
- Hủy lịch chưa có giới hạn thời gian: hiện khách hủy lúc nào cũng không mất buổi. Hệ thống có sẵn tham số "phải hủy trước bao nhiêu giờ", mặc định tắt, để admin bật khi đã thống nhất chính sách với khách.
- Quy tắc trừ buổi, tính công và màu của từng trạng thái là cấu hình của admin; bảng trên là giá trị khởi tạo.
- Từ một buổi trên lịch, PT mở thẳng nhật ký buổi tập (mục 7) để ghi kết quả.

### 6.3 Xóa buổi tập và Burn Show
- Xóa buổi trong Lịch sử check-in: admin xóa được một buổi đã ghi nhận khi phát hiện sai phạm hoặc check-in nhầm. Khách được hoàn lại 1 buổi, PT mất công của buổi đó, báo cáo tự tính lại. Bắt buộc nhập lý do; buổi bị xóa vào Thùng rác; khách nhận email báo hoàn buổi kèm lý do.
- Buổi thuộc kỳ đã chi trả cho HLV: vẫn xóa được. Phiếu chi đã lập giữ nguyên, và hệ thống tự tạo một khoản điều chỉnh giảm cho HLV đó ở kỳ chi trả kế tiếp. Ví dụ: công tháng 10 đã trả theo 27 buổi; ngày 15/11 xóa một buổi của ngày 20/10 thì bảng công tháng 11 có thêm dòng "trừ 1 buổi do xóa buổi ngày 20/10".
- Burn Show: admin thêm tay một buổi vào Lịch sử check-in, dùng trong hai trường hợp: ghi lại buổi đã bị xóa nhầm, và ghi nhận buổi có diễn ra nhưng chưa được book. Trường nhập: chi nhánh, ngày, giờ check-in, giờ check-out, hội viên, nhân viên (PT), mô tả lý do bắt buộc. Buổi burn trừ 1 buổi của khách và tính công cho PT như buổi Đã tập, và được đánh dấu "thêm tay".

### 6.4 Lịch lớp
- Lớp: tên lớp, HLV đứng lớp, chi nhánh, khung giờ, sức chứa, lặp lại theo tuần. Hiện tại Group Training chạy thứ Hai đến thứ Bảy, hai khung 12:15 - 13:15 và 19:00 - 20:00.
- Lịch: hiển thị cùng dạng lưới thời gian với lịch PT, xem theo ngày và tuần.
- Đăng ký chỗ: lễ tân hoặc HLV thêm khách vào buổi lớp; chặn khi lớp đầy hoặc hợp đồng lớp nhóm hết buổi, hết hạn. Hỗ trợ khách drop-in.
- Điểm danh: đánh dấu từng khách có mặt hoặc vắng. Có mặt thì trừ 1 buổi trên hợp đồng lớp nhóm của khách đó.
- Ghi nhận cho HLV: mỗi buổi lớp đã dạy tính là một buổi dạy của HLV. Cách phân bổ doanh thu lớp nhóm cho HLV còn là câu hỏi mở.

### 6.5 Doanh thu phân bổ theo HLV

Báo cáo theo file xuất "employee_pt_training" của GymMaster. Mỗi dòng là một cặp HLV - hợp đồng trong kỳ báo cáo.

| Cột | Cách tính |
|---|---|
| Mã và tên nhân viên, mã và tên hội viên, SĐT, chi nhánh | Lấy từ hồ sơ |
| Mã HĐ, Dịch vụ, Giá trị HĐ | Lấy từ hợp đồng |
| Giá trị phân bổ | Phần giá trị hợp đồng dùng để chia cho các buổi |
| Số buổi tập | Số buổi thực của hợp đồng: buổi mua cộng buổi tặng |
| Phân bổ/buổi | Giá trị phân bổ chia Số buổi tập |
| Show dạy | Số buổi tính công của HLV đó cho hợp đồng đó trong kỳ (Đã tập, Khách không đến, Burn Show) |
| Tỉ lệ hoa hồng, Tỉ lệ chấm công PT | Tham số cấu hình, hiện đang là 100% |
| Tổng phân bổ cho PT | Show dạy nhân Phân bổ/buổi nhân tỉ lệ |
| Tổng show | Tổng số buổi tính công của HLV trong kỳ, trên mọi hợp đồng |
| Điều chỉnh | Các dòng trừ do xóa buổi thuộc kỳ đã chi trả |
| Trial ra HĐ, Note | Buổi tập thử dẫn đến hợp đồng; ghi chú |

- Một hợp đồng có thể do nhiều HLV dạy; doanh thu chia theo số buổi mỗi người thực dạy.
- Báo cáo lọc theo kỳ, HLV, chi nhánh; có dòng tổng theo HLV; xuất Excel đúng thứ tự cột của file hiện tại.
- Báo cáo này là cơ sở để lập phiếu chi trả HLV trong Sổ quỹ (mục 8.1).

### 6.6 Sẵn sàng tích hợp máy vân tay

Máy vân tay gắn sau, nhưng dữ liệu, luồng xác nhận và API của lịch PT và buổi tập phải xây sẵn theo mục này ngay trong giai đoạn 1, để khi gắn máy không phải làm lại. Mọi con số là giá trị khởi tạo, admin chỉnh được.

Luồng hoàn chỉnh

1. PT đặt lịch trên lưới lịch PT.
2. Khách và PT cùng quét vân tay tại phòng tập.
3. Hệ thống ghép cặp quét với lịch đã đặt và chuyển buổi sang Đã tập, hình thức xác nhận "thiết bị".
4. Cùng một sự kiện "buổi tập được xác nhận" kích hoạt: trừ 1 buổi trên hợp đồng, tính công và doanh thu phân bổ cho PT (báo cáo PT training), email báo khách số buổi đã tập và còn lại, ghi nhật ký. Admin bấm tay "Đã tập" đi vào đúng sự kiện này, không có luồng thứ hai.
5. Sổ quỹ không ghi theo từng lần quét. Tiền trả PT đi ra khỏi Sổ quỹ khi kế toán lập phiếu chi theo kỳ, từ báo cáo doanh thu phân bổ.

Quy tắc ghép cặp quét với lịch

| Tình huống | Xử lý |
|---|---|
| Nguyên tắc chung | Mỗi buổi tập (1 giờ) cần một cặp quét riêng: 1 lần quét của khách và 1 lần quét của đúng PT được đặt cho buổi đó. Một lần quét chỉ dùng cho một buổi |
| Ghép cặp trong 15 phút | Khách quét thì hệ thống ghi nhận và treo tối đa 15 phút chờ PT của khách quét. PT quét trong 15 phút đó thì buổi chuyển sang Đã tập. Áp dụng tương tự khi PT quét trước, và khi cả hai check-in trước giờ bắt đầu |
| Quá 15 phút mà PT chưa quét | Buổi treo với lý do "Thiếu check-in của PT" |
| Quá 15 phút mà khách chưa quét (PT quét trước) | Buổi treo với lý do "Thiếu check-in của khách" |
| Khung ghép với lịch | Cặp quét phải nằm trong khoảng từ 1 giờ trước giờ bắt đầu đến 1 giờ sau giờ kết thúc của một lịch đã đặt giữa đúng khách và đúng PT đó |
| Khách tập 2 – 3 buổi trong cùng ngày, có thể với các PT khác nhau | Bình thường, không giới hạn số buổi mỗi ngày. Khách quét bấy nhiêu lần, mỗi lần cùng PT của buổi đó. Mỗi buổi trừ vào hợp đồng gắn trên lịch của nó và tính công cho PT của nó |
| PT dạy liền nhiều khách | PT quét một lần cho mỗi buổi, ghép cặp với lần quét của từng khách |
| Có nhiều lịch khớp cùng một cặp quét | Ghép với lịch chưa xác nhận có giờ bắt đầu gần nhất; buổi kế tiếp cần cặp quét mới |
| Quét mà không có lịch đã đặt | Ghi nhận LỖI, không trừ buổi, không tính công. Lần quét lỗi nằm trong danh sách riêng để admin xem |
| Quét lặp lại trong vài giây (bấm hai lần) | Coi là một lần quét |
| Quét vào hợp đồng hết buổi, hết hạn hoặc tạm vô hiệu | Ghi nhận LỖI, không tính |

Khi buổi chưa có cặp quét hợp lệ

- Sau khi kết thúc ca trong ngày, PT nhận thông báo đẩy danh sách buổi của mình chưa đủ check-in.
- PT chọn từ drop-down: "Khách có tập nhưng quên quét" (gửi yêu cầu admin xác nhận Đã tập) hoặc "Khách không lên tập" (chuyển sang Khách không đến hoặc Hủy lịch theo đúng thực tế).
- Sau 24 giờ vẫn treo thì báo lên Studio Manager và tạo việc trong phân hệ Giao việc.
- Báo cáo đếm số buổi phải xác nhận tay của từng PT và từng khách.

Dữ liệu và kết nối

- Mã vân tay: hồ sơ khách và hồ sơ nhân viên có trường "Mã người dùng trên máy" (ví dụ 2606002 trong GymMaster). CRM chỉ lưu mã này, không lưu dấu vân tay hay ảnh khuôn mặt. Nhập mã cũ từ GymMaster để khách không phải đăng ký lại.
- Lần quét thô: lưu mọi lần quét nhận từ máy (mã người dùng, máy, thời điểm, kết quả ghép) để đối soát.
- Thiết bị: mỗi máy gắn một chi nhánh và có khóa bảo mật riêng; chỉ máy đã đăng ký được gửi dữ liệu.
- Mất mạng và đồng bộ giờ: lần quét khi mất mạng được lưu tạm và gửi bù, ghép theo thời điểm quét thật; cảnh báo khi giờ trên máy lệch.
- API nhận lần quét làm sẵn trong M5, dù chưa có máy.

Khảo sát NextFace ID (developer trả lời trước M5)

Hiện Flow dùng phần mềm NextFace ID cài trên máy tính để nối máy vân tay với GymMaster; phần mềm có mục Thiết bị, Cấu hình mã và "Nhập dữ liệu từ GymMaster".

- ☐ Model và hãng của máy vân tay đang dùng (trong NextFace ID: Danh mục → Thiết bị).
- ☐ Phương án A: NextFace ID có xuất hoặc đẩy dữ liệu lần quét sang phần mềm khác không? Cần hỏi nhà cung cấp.
- ☐ Phương án B: nối CRM trực tiếp với máy qua SDK hoặc giao thức của hãng, bằng một chương trình nhỏ chạy tại phòng tập.
- ☐ Phương án C: nếu A và B đều không được, đề xuất máy mới có sẵn kết nối đẩy dữ liệu lên máy chủ, kèm chi phí.
- ☐ Dấu vân tay đã đăng ký trên máy có giữ được khi đổi phần mềm không.


## 7. Giáo án và nhật ký buổi tập

Phần danh mục học theo GymMaster; phần nhật ký buổi tập và theo dõi tiến độ là phần mới, làm theo mẫu "Flow Workout Log".

### 7.1 Danh mục
- Thiết bị: mã, tên, ghi chú, hiệu lực.
- Area (body): mã, tên, danh mục cha để phân cấp, ghi chú, hiệu lực.
- Bài tập: tên, Area, thiết bị, mô tả, link video, hiệu lực, và loại bài tập (Sức mạnh hoặc Cardio). Cardio là bài tập trong danh mục, không phải một phần riêng của giáo án.
- Stage (giai đoạn): tên, mô tả, hiệu lực. Ví dụ: Rehab.
- Template giáo án: tên, PT tạo, chi nhánh, ngày tạo, hiệu lực, ghi chú; gồm nhiều stage, mỗi stage là một danh sách bài tập.

### 7.2 Giáo án của khách
- Thông tin chung: hội viên, hợp đồng dịch vụ, PT, chi nhánh, ngày, Phase, Goal, PT đánh giá và ghi chú, Master đánh giá và ghi chú, ghi chú giáo án.
- Tạo từ template rồi chỉnh riêng, hoặc tạo mới từ đầu; thêm stage và chọn bài tập từ danh mục.
- Trường kế hoạch cho bài Sức mạnh, theo từng set: Weight, Reps, Rest, RIR, Tempo, Technique, Notes, Video.
- Trường kế hoạch cho bài Cardio: Thời gian, Tốc độ, Nhịp tim, Notes. Khi chọn bài loại Cardio, dòng đó tự hiện ba ô này thay cho các ô tạ.
- Giáo án lập theo tuần, mỗi tuần nhiều buổi (mẫu hiện tại là 3 buổi mỗi tuần).

### 7.3 Nhật ký buổi tập

Mỗi buổi có 3 phần; coach hỏi khách và nhập toàn bộ.

| Phần | Trường | Kiểu nhập |
|---|---|---|
| Thông tin buổi | Học viên, coach, ngày tập, mục tiêu buổi | Tự điền từ lịch và giáo án |
| Pre-session | Mức stress trong ngày | Thang 1-10, kèm ghi chú |
| Pre-session | Mức năng lượng trong ngày | Thang 1-10, kèm ghi chú |
| Pre-session | Ảnh hưởng đến buổi tập | Thấp, Trung bình, Cao, Không ảnh hưởng |
| In-session | Kế hoạch từng set (từ giáo án) | Chỉ đọc |
| In-session | Thực tế từng set: Weight, Reps, RIR; với Cardio: Thời gian, Tốc độ, Nhịp tim | Nhập số, cùng dòng với kế hoạch |
| In-session | Flag | Normal, Stress, Overload, Pattern, Spike/Neuro |
| In-session | Action | None, Theo dõi thêm, Giảm tải, Tăng tải, Đổi bài, Dừng + Escalation |
| In-session | Ghi chú | Văn bản |
| Post-session | Độ khó buổi tập (sRPE) | Thang 1-10, kèm ghi chú |
| Post-session | Năng lượng sau buổi | Thang 1-10, kèm ghi chú |
| Post-session | Tổng kết buổi tập | Không thay đổi, Tốt hơn, Tệ hơn, Khác |
| Post-session | Coach Notes | Văn bản |

- Kế hoạch và thực tế nằm trên cùng một bảng, một dòng cho mỗi set. Không có cột Match tự tính và không có khối Cardio riêng.
- Ý nghĩa Flag: Normal là đúng kế hoạch; Stress là có dấu hiệu stress quá mức; Overload là tăng tải quá nhanh; Pattern là có mẫu vận động cần điều chỉnh; Spike/Neuro là kích hoạt thần kinh cao.
- Nhập nhanh trên điện thoại: số thực tế mặc định bằng kế hoạch, Flag mặc định Normal, Action mặc định None; coach chỉ sửa chỗ khác biệt.
- Danh sách Flag, Action và các thang điểm là danh mục admin chỉnh được.

### 7.4 Escalation
- Khi coach chọn Action "Dừng + Escalation", hệ thống gửi thông báo ngay cho quản lý và Master, kèm tên khách, coach, bài tập, Flag và ghi chú; bấm vào là mở đúng buổi tập đó.
- Mỗi escalation là một việc trong phân hệ Giao việc, nằm trong danh sách chờ cho đến khi quản lý hoặc Master đánh dấu đã xem và ghi hướng xử lý.

### 7.5 Theo dõi tiến độ trong hồ sơ khách
- Danh sách giáo án và các buổi đã tập, mở lại được từng buổi.
- Tiến độ: số buổi đã tập trên kế hoạch, Phase và Stage hiện tại.
- Diễn biến theo thời gian của từng bài tập (mức tạ, reps), của stress, năng lượng, sRPE, và lịch sử Flag / Action.

## 8. Sổ quỹ, giao việc, email, nhân viên và thùng rác

### 8.1 Sổ quỹ

Sổ quỹ gắn chặt với hợp đồng của khách và với chấm công giờ dạy của HLV: mọi khoản tiền vào và ra đều là một phiếu, và số "đã thanh toán" của hợp đồng chỉ được tính từ phiếu thu.
- Phiếu thu: số phiếu, ngày thu, khách, hợp đồng hoặc phiếu biến động liên quan, số tiền, hình thức (tiền mặt, chuyển khoản, thẻ), người thu, nhân viên sale, chi nhánh, ghi chú, ảnh chứng từ chuyển khoản.
- Phiếu chi: số phiếu, ngày chi, loại chi (danh mục cấu hình được), người nhận, số tiền, hình thức, người chi, chi nhánh, ghi chú. Hoàn tiền khi hủy hợp đồng là một phiếu chi gắn với hợp đồng đó.
- Liên kết hợp đồng: thu tiền hợp đồng luôn tạo phiếu thu; đã thanh toán, còn nợ và trạng thái thanh toán tự tính từ các phiếu thu còn hiệu lực.
- Liên kết giờ dạy HLV: từ báo cáo doanh thu phân bổ theo HLV của một kỳ, kế toán tạo phiếu chi trả cho từng HLV; phiếu chi lưu kỳ và số buổi đã tính để không chi trùng. Các dòng điều chỉnh do xóa buổi được trừ vào kỳ kế tiếp.
- Ngày thu tiền: sửa ngày thu là quyền riêng và luôn ghi nhật ký.
- Xóa phiếu: cần lý do, vào Thùng rác, số phiếu không cấp lại. Xóa phiếu thu làm hợp đồng tự tính lại công nợ.
- Báo cáo: sổ quỹ theo ngày và theo kỳ (tồn đầu, thu, chi, tồn cuối) theo từng hình thức và chi nhánh; báo cáo thu chi; báo cáo công nợ hội viên.
- Giới hạn: đây là sổ thu chi nội bộ, không phải phần mềm kế toán thuế. Hạch toán, hóa đơn điện tử và báo cáo thuế vẫn làm ở phần mềm kế toán; hệ thống xuất Excel để đối chiếu.

### 8.2 Giao việc

Phân hệ giao việc là nơi các phòng ban giao và nhận công việc với nhau và trong nội bộ, để không sót việc.
- Công việc gồm: tiêu đề, mô tả, người giao, người nhận (một người hoặc một phòng ban), hạn, mức ưu tiên, trạng thái, và liên kết đến đối tượng liên quan (lead, khách, hợp đồng, buổi tập).
- Trạng thái: Mới, Đã nhận, Đang làm, Hoàn thành, Hủy. Người nhận phải bấm xác nhận đã nhận.
- Trao đổi: bình luận ngay trong công việc; nhắc tên người liên quan.
- Việc tự sinh từ hệ thống: bước "Báo Studio" trong hành trình tư vấn (cho coach Manager: khách nào, hẹn lúc nào, loại Assessment, Pain Status); escalation từ buổi tập; hợp đồng và giá ngoại lệ chờ duyệt; hợp đồng Tạm vô hiệu quá 10 ngày; email gửi khách bị lỗi.
- Việc tạo tay: bất kỳ nhân viên nào cũng giao được việc cho người hoặc phòng ban khác, theo quyền được cấp.
- Màn hình: "Việc của tôi", "Việc tôi giao", việc theo phòng ban; lọc theo trạng thái và hạn; việc quá hạn được làm nổi và báo cho người giao.
- Thông báo trong hệ thống: khi được giao, khi quá hạn, khi có bình luận mới, và nhắc trước hạn nhiều mốc. Mốc nhắc khởi tạo: trước 24 giờ, trước 3 giờ, trước 1 giờ. Admin thêm, bớt, sửa mốc chung; người giao việc sửa được mốc cho từng việc.
- Báo cáo: số việc giao, hoàn thành đúng hạn, trễ hạn theo người và theo phòng ban.
- Thông báo cho nhân viên ngoài hệ thống: ngoài chuông trong hệ thống, nhân viên nhận email và thông báo đẩy trên điện thoại (khi đăng nhập CRM trên điện thoại) cho: việc sắp đến hạn theo các mốc nhắc, việc quá hạn, yêu cầu duyệt đang chờ, escalation, lead mới được giao hoặc bị chuyển lượt, buổi tập chưa đủ check-in. Mỗi nhân viên chọn loại nhận qua email hoặc điện thoại; admin đặt loại nào bắt buộc. Developer đề xuất cách làm thông báo đẩy và giới hạn trên iPhone, Android.

### 8.3 Hạ tầng email tự động cho khách hàng

- Trọng tâm là thiết lập được hạ tầng gửi email, để mọi thao tác ảnh hưởng đến quyền lợi của khách đều tự động báo về email của khách; mẫu email là phần nhỏ đi kèm.
- Máy chủ và tên miền gửi: dịch vụ gửi email giao dịch (Resend hoặc Amazon SES), xác thực tên miền Flow (SPF, DKIM, DMARC) để không rơi vào thư rác, địa chỉ gửi và địa chỉ nhận phản hồi của Flow. Tài khoản dịch vụ đăng ký dưới tên Flow Group.
- Hàng đợi và gửi lại: email gửi qua hàng đợi, lỗi thì tự thử lại; trạng thái đã gửi, lỗi, bị trả về lưu trong hồ sơ khách.
- Thứ tự làm: dựng ngay khi bắt đầu M4, để mỗi nghiệp vụ của M4, M5, M8 khi làm xong là gắn email luôn.
- Email là kênh thông báo duy nhất cho mọi khách hàng, không phân biệt Việt Nam hay nước ngoài. Không dùng Zalo OA.
- Số buổi thay đổi thì gửi email: buổi được ghi nhận (Đã tập, Khách không đến, Burn Show) kèm số buổi đã tập và còn lại; buổi được hoàn lại do xóa, kèm lý do và số buổi còn lại mới.
- Email hoàn buổi là điểm làm tốt hơn GymMaster: GymMaster chỉ báo khi check-in, không báo khi buổi bị xóa.
- Các sự kiện ảnh hưởng quyền lợi khác, admin bật tắt từng loại: xác nhận lịch hẹn, hợp đồng được kích hoạt, phiếu thu, gia hạn, nâng cấp, bảo lưu, chuyển nhượng, hủy, tạm vô hiệu và kích hoạt lại kèm hạn mới, hợp đồng sắp hết hạn hoặc sắp hết buổi.
- Mẫu email do admin soạn, có bản tiếng Việt và tiếng Anh; khách có quốc gia Việt Nam nhận tiếng Việt, các quốc gia khác nhận tiếng Anh.
- Email là trường bắt buộc khi chuyển lead thành khách hàng. Khách thiếu email được làm nổi để lễ tân bổ sung.
- Mỗi email gửi đi được lưu trong hồ sơ khách kèm trạng thái đã gửi hoặc lỗi; email lỗi tạo việc cho lễ tân.
- Gửi qua một dịch vụ email giao dịch, từ tên miền của Flow đã cấu hình xác thực để không rơi vào thư rác; developer đề xuất dịch vụ và chi phí.

### 8.4 Nhân viên
- Hồ sơ: mã nhân viên, họ tên, ngày sinh, giới tính, SĐT, email, giấy tờ, phòng ban, nhóm, chức danh, quản lý trực tiếp, chi nhánh, trạng thái làm việc, có dạy PT hay không, mã người dùng trên máy vân tay. Với tư vấn viên: hệ số lượt chia lead và bật / tắt nhận lead.
- Lịch làm việc của PT: ca trực và ngày nghỉ, dùng để hiển thị trên lưới lịch và báo cáo buổi dạy trong / ngoài ca; không giới hạn việc đặt lịch.
- Mỗi nhân viên gắn một tài khoản đăng nhập theo mục 2.

### 8.5 Thùng rác
- Mọi dữ liệu nghiệp vụ bị xóa (hợp đồng, phiếu thu, phiếu chi, buổi tập, lịch) rời khỏi hệ thống làm việc và vào Thùng rác, kèm người xóa, thời điểm và lý do bắt buộc.
- Dữ liệu trong Thùng rác được lưu vĩnh viễn; chỉ ban quản trị xem được, xem bất cứ lúc nào; không ai xóa được.
- Mã hợp đồng và số phiếu đã xóa không được cấp lại.

## 9. Dashboard và báo cáo

Mọi báo cáo lọc được theo chi nhánh, thời gian, nhân viên và xuất được Excel; mỗi báo cáo là một quyền riêng.

| Báo cáo | Nội dung |
|---|---|
| Dashboard tổng quan | Lead mới, tỷ lệ chuyển đổi, hội viên đang tập, PT hoạt động, hợp đồng sắp hết hạn, số buổi PT theo giờ trong ngày, doanh thu theo tháng và năm |
| Dashboard tư vấn | Theo từng nhân sự và toàn đội: số lead nhận, phễu Lead → Đã tư vấn → Đã đặt lịch → Show → Ký hợp đồng, tỷ lệ show, tỷ lệ tuân thủ các bước đúng hạn, thời gian phản hồi đầu tiên, kết quả tái chăm sóc, điểm audit, số lần bị chuyển lượt, tỷ lệ thực hiện từng bước checklist và tương quan với tỷ lệ đặt lịch, show, ký hợp đồng |
| Phân tích lead | Theo kênh liên hệ, nguồn lead, Organic / Paid, nhóm nhu cầu, quốc tịch, lý do từ chối |
| Dashboard giáo án theo tuần | Trên toàn bộ khách hàng: tỷ lệ % từng loại Flag và từng loại Action tính trên tổng số set đã ghi; số khách có ít nhất một Flag khác Normal; so sánh với tuần trước; escalation đang chờ. Bấm vào một tỷ lệ để xem danh sách khách và buổi tập tương ứng |
| Báo cáo hợp đồng | Doanh thu, công nợ, hợp đồng mới và tái ký, sắp hết hạn hoặc sắp hết buổi; nhóm theo dịch vụ và theo bậc số buổi |
| Báo cáo giá ngoại lệ | Tỷ lệ hợp đồng giá ngoại lệ và tổng mức chênh, theo người tạo và người duyệt |
| Báo cáo Booking | Khách, SĐT, giờ vào, giờ ra, trạng thái, nhân viên, ngày tạo; lọc theo loại booking và trạng thái |
| Doanh thu phân bổ theo HLV | Theo mục 6.5 |
| Sổ quỹ | Sổ quỹ theo kỳ, thu chi, công nợ hội viên, theo mục 8.1 |
| Giao việc | Việc giao, đúng hạn, trễ hạn theo người và phòng ban |


## 10. Mô hình dữ liệu

Trục chính là Người (lead / khách) → Hợp đồng → Buổi tập → Phiếu thu chi; mọi bảng nghiệp vụ đều có chi nhánh, người tạo, thời điểm tạo và sửa.

| Thực thể | Trường cốt lõi | Quan hệ |
|---|---|---|
| Chi nhánh | Tên, địa chỉ, hiệu lực | Cha của hầu hết thực thể |
| Người dùng, Vai trò, Quyền | Tài khoản, vai trò, quyền theo phân hệ và thao tác, quyền riêng, ngưỡng duyệt, thời gian truy cập, lịch sử đăng nhập | Gắn với nhân viên |
| Nhân viên | Mã, họ tên, phòng ban, chức danh, quản lý trực tiếp, chi nhánh, ca trực, mã người dùng trên máy vân tay, hệ số lượt chia lead, bật nhận lead, trạng thái | Phụ trách lead, khách, buổi tập |
| Kênh liên hệ, Nguồn lead | Tên, phân loại Organic / Paid | Gắn vào lead |
| Lead / Khách hàng | Mã lead, mã khách, họ tên, SĐT, email, quốc gia, mã người dùng trên máy vân tay, kênh, nguồn, nhóm nhu cầu, chi tiết nhu cầu, Pain Status, loại Assessment, trạng thái, người phụ trách, giấy tờ, ngày sinh, quốc tịch, sức khỏe | Một hồ sơ duy nhất, đổi trạng thái theo hành trình |
| Bước tư vấn | Loại bước, hạn, thời điểm hoàn thành, người thực hiện, kết quả, đúng hạn hay trễ | Thuộc một lead |
| Lịch sử lead, Lịch hẹn | Trạng thái cũ và mới, lý do từ chối; ngày giờ hẹn, xác nhận lần 1 và 2, Show / No show | Thuộc một lead |
| Audit tư vấn | Điểm tự động, điểm và nhận xét của quản lý, đề xuất của AI | Thuộc một lead |
| Kịch bản tư vấn | Tình huống, nội dung tiếng Việt và tiếng Anh, hiệu lực | Danh mục dùng chung |
| Dịch vụ, Bậc giá | Dịch vụ: tên, loại, khung giờ, tỉ lệ hoa hồng. Bậc giá: khoảng số buổi, đơn giá, thời hạn, phiên bản, ngày hiệu lực | Dùng trong hợp đồng |
| Ưu đãi, Voucher | Tên, kiểu giảm, giá trị, thời gian áp dụng | Áp vào hợp đồng |
| Hợp đồng | Mã, khách, dịch vụ, loại, buổi mua, buổi tặng, đơn giá theo bậc, đơn giá được duyệt, cờ giá ngoại lệ và lý do, giá trị, VAT, ngày bắt đầu và hết hạn, hợp đồng nối tiếp, PT và Sale kèm tỉ lệ, thông tin ký, trạng thái, người duyệt | Thuộc một khách |
| Lần tạm vô hiệu | Ngày khóa, ngày mở, lý do, số ngày được cộng | Thuộc một hợp đồng |
| Phiếu biến động | Loại nghiệp vụ, hợp đồng gốc, các trường riêng, trạng thái duyệt | Thuộc một hợp đồng |
| Phiếu thu, Phiếu chi | Số phiếu, số tiền, ngày, hình thức, người lập, loại chi, kỳ chi trả | Phiếu thu thuộc hợp đồng; phiếu chi gắn hợp đồng hoặc HLV |
| Lịch / Buổi tập | Khách, hợp đồng, PT, giờ bắt đầu và kết thúc, trạng thái, hình thức xác nhận, cờ thêm tay | Trừ buổi của một hợp đồng |
| Điều chỉnh công HLV | HLV, buổi bị xóa, kỳ áp dụng, số tiền | Sinh ra khi xóa buổi thuộc kỳ đã chi |
| Lớp, Buổi lớp, Điểm danh | Tên lớp, HLV, khung giờ, sức chứa; ngày của buổi; khách, hợp đồng, có mặt hay vắng | Điểm danh trừ buổi của một hợp đồng |
| Thiết bị, Area, Bài tập, Stage, Template | Theo mục 7.1; bài tập có loại Sức mạnh / Cardio | Danh mục dùng chung |
| Giáo án của khách, Dòng kế hoạch | Khách, hợp đồng, PT, Phase, Goal, đánh giá; buổi, stage, bài tập, set, chỉ số mục tiêu | Thuộc một khách |
| Nhật ký buổi tập, Kết quả set | Chỉ số Pre và Post-session, Coach Notes; chỉ số thực tế, Flag, Action, ghi chú | Một nhật ký cho một buổi tập |
| Công việc | Tiêu đề, người giao, người hoặc phòng ban nhận, hạn, ưu tiên, trạng thái, bình luận, nguồn sinh | Liên kết đến lead, khách, hợp đồng hoặc buổi tập |
| Mẫu email, Email đã gửi | Loại sự kiện, nội dung Việt và Anh, bật tắt; người nhận, thời điểm, trạng thái | Email đã gửi thuộc một khách |
| Tham số hệ thống | Mốc thời gian, quy tắc trạng thái buổi, màu, khung giờ lịch, ngưỡng nhắc | Toàn hệ thống |
| Thùng rác, Nhật ký thao tác | Bản ghi bị xóa kèm lý do; ai, lúc nào, đối tượng, giá trị trước và sau | Toàn hệ thống |
| Lịch sử chuyển lượt lead | Lead, từ người, sang người, thời điểm, thời gian đã chờ, tự động hay bằng tay | Thuộc một lead |
| Thiết bị check-in, Lần quét | Máy: tên, chi nhánh, khóa bảo mật. Lần quét: mã người dùng, máy, thời điểm, kết quả ghép (hợp lệ, chờ ghép, lỗi), buổi tập được ghép | Lần quét ghép vào tối đa một buổi tập |
| Mốc nhắc, Cài đặt thông báo | Danh sách mốc nhắc chung và của từng việc; loại thông báo mỗi nhân viên nhận qua email, điện thoại | Gắn với công việc và nhân viên |

- Số buổi đã tập và còn lại của hợp đồng luôn tính từ buổi tập và phiếu biến động, không nhập tay.
- Đã thanh toán và công nợ luôn tính từ phiếu thu còn hiệu lực.
- Không xóa cứng dữ liệu nghiệp vụ; xóa là chuyển vào Thùng rác.
- Mã (lead, khách, hợp đồng, phiếu) sinh tự động, tiền tố cấu hình được, giữ được mã cũ khi nhập dữ liệu từ GymMaster (ví dụ HV0013, HP260207).

## 11. Tích hợp, yêu cầu kỹ thuật và chuyển dữ liệu

### Tích hợp kênh lead

| Kênh | Cách lấy lead mong muốn | Ghi chú cho developer |
|---|---|---|
| WhatsApp | WhatsApp Business API | Kênh có nhiều lead nhất trong file hiện tại; có thể phát sinh phí theo hội thoại |
| Messenger (Fanpage), Instagram | API / webhook tin nhắn và form lead | Cần khảo sát quyền truy cập và quy trình xét duyệt ứng dụng |
| Zalo | Zalo Official Account API | Chỉ để nhận lead; không dùng để gửi thông báo cho khách |
| TikTok, Threads | API nếu có | Cần khảo sát; dự phòng nhập tay |
| Gmail, Website | Chuyển tiếp email hoặc form trên website | Làm đơn giản được |
| Gọi điện, khách tự tìm đến, kênh cộng tác | Form nhập tay | Làm trước tiên |
| Google Maps, Google Ads, ChatGPT, Người quen | Đây là nguồn lead, không phải kênh nhắn tin | Người tư vấn chọn nguồn khi nhập; không cần tích hợp |


Nhập tay phải dùng được ngay từ bản đầu; từng kênh API được bật dần và không làm chậm phần lõi. Developer báo lại kênh nào khả thi, chi phí và thời gian trước khi làm.

### Yêu cầu kỹ thuật
- Nền tảng: ứng dụng web, dùng tốt trên điện thoại. App mobile riêng để giai đoạn sau.
- Kiến trúc: tách backend API và giao diện; API có tài liệu, để các module ERP sau này, app mobile và thiết bị check-in dùng chung.
- Cấu hình thay cho mã cứng: mọi giá trị ở cột "Admin tùy biến" của mục 1 nằm trong cơ sở dữ liệu và có màn hình quản lý.
- Sở hữu: chủ đầu tư sở hữu toàn bộ mã nguồn, cơ sở dữ liệu, tên miền và tài khoản hạ tầng. Mã nguồn nằm trên kho Git của chủ đầu tư. Các tài khoản hạ tầng (Vercel, Railway / Render, Resend / SES, tên miền) đăng ký dưới tên và email của Flow Group. Chi phí vận hành đã báo khoảng 65 – 130 USD mỗi tháng cho cả hai môi trường.
- Công nghệ: developer đề xuất, ưu tiên công nghệ phổ biến, dễ tìm người thay thế và chi phí vận hành thấp.
- Ngôn ngữ: giao diện tiếng Việt; thiết kế sẵn để thêm tiếng Anh.
- Bảo mật: phân quyền kiểm tra ở phía server, mật khẩu được băm, HTTPS, sao lưu tự động hằng ngày và có thử khôi phục.
- Dữ liệu cá nhân: hệ thống lưu giấy tờ tùy thân và thông tin sức khỏe, thuộc nhóm dữ liệu nhạy cảm theo quy định bảo vệ dữ liệu cá nhân của Việt Nam. Cần mã hóa các trường này, giới hạn người xem và ghi nhận sự đồng ý của khách. Số CCCD / hộ chiếu chưa được lưu cho đến khi phần mã hóa hoàn thành (trong M2). CRM không lưu dấu vân tay hay ảnh khuôn mặt, chỉ lưu mã người dùng trên máy. Chủ đầu tư nên xác nhận yêu cầu cụ thể với tư vấn pháp lý.
- AI audit: nếu gửi nội dung chat của khách đến dịch vụ AI bên ngoài, cần sự đồng ý của chủ đầu tư và phương án ẩn thông tin định danh.
- Môi trường: có bản thử nghiệm (staging) tách khỏi bản chạy thật.

### Chuyển dữ liệu từ GymMaster
- Xuất Excel từ GymMaster: khách hàng, hợp đồng còn hạn, số buổi đã tập, phiếu thu, nhân viên, lịch sử booking. Nhập thêm lead từ file Excel tư vấn.
- Làm sạch hợp đồng cũ: gắn mỗi hợp đồng vào đúng dịch vụ và đặt lại tên theo số buổi thực. Công cụ nhập xuất danh sách các hợp đồng có số buổi khác tên gói hoặc đơn giá khác bậc giá, để chủ đầu tư xác nhận từng trường hợp. Dữ liệu hiện có gói 24 buổi ghi 30 buổi do sửa tay, và gói 110 buổi ghi 217 buổi nghi là lỗi hệ thống cũ.
- Chạy thử trên staging, đối chiếu tổng số khách, tổng giá trị hợp đồng, đã thanh toán và số buổi còn lại trước khi chuyển thật.
- Chạy song song hai hệ thống trong một khoảng thời gian ngắn trước khi ngừng GymMaster.

## 12. Lộ trình, nghiệm thu và câu hỏi mở

### Thứ tự bàn giao đề xuất

Mỗi mốc là một bản chạy được trên staging để chủ đầu tư dùng thử. Developer báo giá và thời gian theo từng mốc, để chủ đầu tư có thể cắt hoặc lùi mốc.
- Nền tảng: đăng nhập, người dùng, vai trò và cây phân quyền tùy biến, chi nhánh, nhân viên, tham số hệ thống, nhật ký thao tác, Thùng rác, thông báo trong hệ thống, phân hệ Giao việc.
- Lead và hành trình tư vấn: nhập tay, phân bổ tự động theo hệ số lượt, tự chuyển lượt có lưu vết, checklist bước có hạn và cơ chế khóa, nhắc việc, tái chăm sóc, thư viện kịch bản, chuyển thành khách hàng.
- Audit và dashboard tư vấn: audit tự động theo quy tắc, audit của quản lý, dashboard theo nhân sự.
- Hợp đồng và Sổ quỹ: dịch vụ và bậc giá, đăng ký, duyệt, giá ngoại lệ, phiếu thu, phiếu chi, xóa có Thùng rác, hủy kích hoạt.
- Lịch PT, lịch lớp và buổi tập: đặt lịch mở toàn thời gian với ca trực, check-in, API nhận lần quét và quy tắc ghép cặp vân tay (mục 6.6), trạng thái buổi, xóa buổi, Burn Show, điểm danh lớp, báo cáo doanh thu phân bổ theo HLV, chi trả HLV.
- Hạ tầng email tự động: dịch vụ gửi, xác thực tên miền, hàng đợi và gửi lại, email và thông báo điện thoại cho nhân viên. Dựng ngay khi bắt đầu M4; mỗi sự kiện ảnh hưởng quyền lợi khách được gắn email ngay khi nghiệp vụ đó làm xong.
- Giáo án và nhật ký buổi tập: danh mục, template, giáo án của khách, nhật ký 3 phần, Flag / Action, escalation, tab tiến độ trong hồ sơ khách, dashboard giáo án theo tuần.
- Nghiệp vụ biến động: gia hạn, bảo lưu, nâng cấp, chuyển nhượng, chuyển chi nhánh, chuyển đổi, hủy.
- Báo cáo còn lại và nhập dữ liệu từ GymMaster và từ file Excel tư vấn.
- Tích hợp API các kênh lead, theo thứ tự khả thi.
- AI hỗ trợ audit, sau khi nội dung chat đã vào hệ thống.

### Tiêu chí nghiệm thu chính
- ☐ Tài khoản không được cấp quyền một phân hệ thì không thấy menu đó và không truy cập được bằng đường dẫn trực tiếp; vai trò bị ẩn SĐT thì không thấy SĐT ở bất kỳ màn hình hay file xuất nào.
- ☐ Admin đổi quyền, ngưỡng duyệt, bậc giá, mốc thời gian và quy tắc trạng thái buổi trên giao diện; thay đổi có hiệu lực ngay, không cần developer.
- ☐ Lead tạo từ form được gán đúng kênh và nguồn, phân lượt đúng vòng, quản lý nhận thông báo.
- ☐ Các bước nhắc 60 phút, 24 giờ, 3 giờ và 60 phút trước hẹn, 15 ngày tự sinh đúng thời điểm; bước quá hạn hiện trong "Việc hôm nay" và bị tính trễ trong audit; bước "Báo Studio" tạo việc cho coach Manager.
- ☐ Dashboard tư vấn cho ra đúng số lead, tỷ lệ đặt lịch, tỷ lệ show của từng nhân sự khi đối chiếu với file Excel tháng 9 và tháng 10/2026.
- ☐ Một người đi hết luồng lead → đặt lịch → show → hợp đồng → buổi tập mà chỉ có một hồ sơ.
- ☐ Nhập một số buổi bất kỳ thì hệ thống tự ra đúng đơn giá theo bậc, ngày kết thúc và tên hiển thị theo số buổi thực; giá khác bậc thì hợp đồng bị gắn "Giá ngoại lệ" và không kích hoạt được khi chưa duyệt.
- ☐ Hợp đồng đã duyệt không sửa trực tiếp được, kể cả bằng tài khoản admin; hợp đồng chưa duyệt không đặt được lịch.
- ☐ Xóa hợp đồng còn phiếu thu thì bị chặn và hệ thống chỉ ra các phiếu cần xóa trước; sau khi xóa đúng thứ tự, tổng thu và doanh thu giảm đúng bằng giá trị đã xóa.
- ☐ Dữ liệu đã xóa nằm trong Thùng rác kèm lý do, chỉ ban quản trị xem được và không xóa được.
- ☐ Hợp đồng Tạm vô hiệu không đặt lịch và không check-in được; kích hoạt lại hiện đúng số ngày đã khóa và hạn mới đề xuất; hạn chỉ đổi sau khi admin xác nhận và không bị cộng trùng; khóa quá 10 ngày thì quản lý được nhắc.
- ☐ "Đã tập" và "Khách không đến" làm số buổi còn lại giảm đúng 1 và tính công cho PT; "Hủy lịch" và "Xóa" thì không; mỗi trạng thái hiện đúng màu; không đặt được khi hết buổi, hết hạn hoặc trùng giờ.
- ☐ Buổi Đã tập không đổi được trạng thái; admin xóa buổi đó thì khách được hoàn đúng 1 buổi, công của PT giảm đúng 1 buổi; nếu thuộc kỳ đã chi trả thì kỳ sau có dòng điều chỉnh.
- ☐ Mỗi lần ghi nhận hoặc hoàn buổi gửi đúng một email cho khách theo mẫu và đúng ngôn ngữ, có lưu trạng thái gửi trong hồ sơ khách.
- ☐ Báo cáo doanh thu phân bổ theo HLV khớp với file xuất của GymMaster trên cùng dữ liệu; phiếu chi trả HLV không chi trùng buổi.
- ☐ Đã thanh toán và công nợ của mỗi hợp đồng luôn bằng tổng phiếu thu còn hiệu lực; tồn cuối Sổ quỹ bằng tồn đầu cộng thu trừ chi.
- ☐ Giáo án và mọi nhật ký buổi tập của một khách xem được trong hồ sơ của khách đó, kế hoạch và thực tế nằm cùng dòng; chọn bài Cardio thì dòng hiện Thời gian, Tốc độ, Nhịp tim.
- ☐ Chọn Action "Dừng + Escalation" thì quản lý và Master nhận thông báo, và mục đó nằm trong danh sách chờ đến khi được xử lý; dashboard giáo án tuần cho đúng tỷ lệ % Flag và Action.
- ☐ Dữ liệu nhập từ GymMaster khớp số khách, giá trị hợp đồng, đã thanh toán và số buổi còn lại.
- ☐ Các màn hình lead, lịch PT và nhật ký buổi tập thao tác được trên điện thoại.
- ☐ Mọi kết quả bước tư vấn, mục checklist và lý do đều là drop-down; admin thêm hoặc vô hiệu một lựa chọn trên giao diện và thay đổi hiện ngay, dữ liệu cũ không đổi.
- ☐ Chọn "Khác" trong bất kỳ drop-down nào thì không lưu được nếu chưa điền nội dung.
- ☐ Thao tác thuộc nhóm cần duyệt chưa có hiệu lực cho đến khi được duyệt; người tạo không tự duyệt được; admin bật tắt yêu cầu duyệt và đổi người duyệt cho từng loại thao tác trên giao diện.
- ☐ PT đặt được lịch ngoài ca trực; lưới hiển thị phân biệt trong và ngoài ca.
- ☐ Lead chỉ cần họ tên và kênh; quốc gia chọn từ danh sách các nước và email gửi đúng ngôn ngữ theo quốc gia.
- ☐ Lead chia đúng theo hệ số lượt; lead chưa chăm sóc sau 1 giờ làm việc thì tự chuyển, không chuyển ngoài khung 08:30 – 20:30, và mỗi lần chuyển có trong lịch sử và dashboard.
- ☐ Bước checklist đã tick không bỏ tick được; bước quá hạn cộng gia hạn thì tự khóa "Không thực hiện" và không tick bù được.
- ☐ Công việc được nhắc đủ 3 mốc trước hạn qua chuông, email và điện thoại; duyệt chậm quá 24 giờ thì báo đúng quản lý trực tiếp của người duyệt.
- ☐ Gửi lần quét giả lập qua API: cặp khách và đúng PT trong 15 phút và trong khung ghép thì buổi chuyển Đã tập và kích hoạt trừ buổi, tính công, email; thiếu một bên thì treo đúng lý do; quét không có lịch thì ghi lỗi; khách tập 2 buổi với 2 PT thì mỗi buổi cần cặp quét riêng.
- ☐ Buổi chưa đủ check-in thì PT nhận thông báo cuối ngày, sau 24 giờ thì Studio Manager được báo.

### Developer cần gửi lại trước khi bắt đầu
- Đề xuất công nghệ và sơ đồ kiến trúc.
- Sơ đồ cơ sở dữ liệu chi tiết dựa trên mục 10.
- Bản phác màn hình (wireframe) cho Lead, Lịch PT, Nhật ký buổi tập và Phân quyền.
- Ước lượng thời gian, chi phí theo từng mốc và chi phí hạ tầng hằng tháng (gồm dịch vụ email).
- Kết quả khảo sát các kênh lead và phương án AI audit.

### Các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Giá | Bậc giá theo khoảng số buổi do admin tự quản lý; giá thỏa thuận là ngoại lệ và phải duyệt |
| Sửa hợp đồng | Khóa sau duyệt, kể cả admin; sai thì xóa và tạo lại; xóa phiếu thu trước |
| Xóa dữ liệu | Vào Thùng rác vĩnh viễn, chỉ ban quản trị xem |
| Tạm vô hiệu | Cộng hạn nửa tự động khi mở lại; nhắc sau 10 ngày |
| Check-in | Giai đoạn 1 admin xác nhận mọi buổi; chưa tích hợp vân tay |
| Trạng thái buổi | Đã tập và Khách không đến trừ buổi và tính công; Hủy lịch thì không; giới hạn giờ hủy để tắt |
| Xóa buổi đã trả công | Cho xóa, điều chỉnh giảm ở kỳ sau |
| Thông báo cho khách | Email cho mọi khách; không dùng Zalo OA |
| Nhật ký buổi tập | Coach nhập cả 3 phần; bỏ Match; Cardio là bài tập trong danh mục |
| Sổ quỹ | Sổ thu chi nội bộ, không phải kế toán thuế |
| Không làm | Chi trả tiền cọc, cập nhật tay số buổi đã tập, Gói tự do, Pro Shop, tủ đồ, Loyalty |
| Lịch PT | Ca là ca trực; đặt lịch mở toàn thời gian cho mọi PT |
| Chia lead | Xoay vòng theo hệ số lượt; tự chuyển sau 1 giờ làm việc trong khung 08:30 – 20:30, có lưu vết; tái chăm sóc sau 15 ngày |
| Checklist tư vấn | Không duyệt; khóa sau khi tick và sau khi quá hạn; dùng để đo quy trình, không phạt |
| Quốc tịch | Danh sách quốc gia; nhóm và ngôn ngữ email tự suy ra |
| Thông báo nhân viên | Chuông, email và điện thoại; nhắc việc 3 mốc 24 giờ, 3 giờ, 1 giờ |
| Master và cấp trên | Admin giữ Master trước; duyệt chậm báo quản lý trực tiếp theo sơ đồ tổ chức |
| Máy vân tay | Ghép cặp khách và PT trong 15 phút, khung ±1 giờ; mỗi buổi một cặp quét; quét không có lịch là lỗi |


### Câu hỏi còn mở cho chủ đầu tư
- ☐ Doanh thu lớp nhóm phân bổ cho HLV theo đầu khách có mặt hay cố định mỗi buổi? Sức chứa mỗi lớp và quy định hủy chỗ?
- ☐ Tỉ lệ hoa hồng và tỉ lệ chấm công PT đặt theo từng HLV, từng dịch vụ hay từng hợp đồng? "Giá trị phân bổ" có khi nào khác "Giá trị HĐ" không? Có cần hoa hồng cho sale không?
- ☐ Công thức phí hủy, phí chuyển nhượng, phí chuyển chi nhánh, giới hạn số ngày bảo lưu?
- ☐ AI audit: có đồng ý cho nội dung chat của khách được gửi đến dịch vụ AI bên ngoài không, và chấm theo tiêu chí nào?
- ☐ Thời điểm gắn máy vân tay, sau khi có kết quả khảo sát NextFace ID ở mục 6.6.
- ☐ Xác nhận bảng ghép chức danh với vai trò và tuyến báo cáo các nhánh Marketing ở mục 2.

Các giá trị admin tự nhập trước ngày chạy thật, không chặn developer: bảng bậc giá của từng dịch vụ, mức giảm tối đa mỗi vai trò được tự duyệt, số buổi tối thiểu của một hợp đồng, khung giờ lưới lịch, danh sách nhân viên và PT của từng chi nhánh, danh mục "Chi tiết nhu cầu" có mã số, mẫu email.
