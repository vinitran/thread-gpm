# Tool GPM · 0.3.2

## App desktop native (0.4.0)

Bản macOS Apple Silicon dùng Swift/AppKit; Windows x64 dùng C#/WPF. Mở app để dùng trực tiếp cửa sổ native, backend chạy ẩn. Không cần trình duyệt, Node.js hoặc .NET cài riêng. Chạy từ source bằng các lệnh bên dưới vẫn dùng web UI để phát triển.

Xem [hướng dẫn Mac](../packaging/macos/HUONG-DAN-MAC.md), [hướng dẫn Windows](../packaging/windows/HUONG-DAN-WINDOWS.md), [build/CI và cập nhật](../packaging/README.md), [cấu trúc native](../desktop/README.md).


Trong bảng profile, dùng **Áp dụng & mở** để áp dụng cấu hình đã lưu và mở trình duyệt. **Dừng profile** gửi lệnh dừng ngay tới GPM theo Profile ID, đồng thời hủy phiên/lịch chạy. Dừng nhóm và Dừng tất cả cũng đóng các profile tương ứng. Start hoặc Chạy các profile đã tích vẫn dùng để bắt đầu automation sau khi đăng nhập Threads.

Token của từng bộ chạy profile được tách khỏi token dashboard. Khi tool khởi động lại và trang giữ token cũ, UI tải token dashboard mới rồi gửi lại yêu cầu bị từ chối một lần.

Cần Node.js 20 trở lên. Giữ gpm-tool cạnh extension vì hai phần dùng chung bộ chạy và ảnh.

```sh
cd gpm-tool
npm ci
npm start
```

Mở http://127.0.0.1:4317. Local API mặc định http://localhost:9495 dành cho GPMLogin Global API v1.

## Mở profile

1. Bấm Tải danh sách profile, chọn profile muốn chạy.
2. Nhập proxy IP:port:user:pass trước khi mở nếu muốn dùng proxy. Để trống nghĩa là không proxy, kể cả profile có proxy cũ.
3. Lưu tất cả cài đặt, bấm Áp dụng cấu hình & mở profile.
4. Tool cập nhật raw_proxy trước khi start, xác nhận cấu hình đã lưu và tự lấy CDP. Khi cấu hình mạng khác, profile sẽ được dừng và mở lại; lưu bản nháp trước thao tác này. Nếu cấu hình đã đúng, dùng lại profile đang chạy.
5. Đăng nhập Threads trong profile, kiểm tra kết nối rồi Start.

Ô proxy hiển thị đầy đủ và tự điền giá trị đã lưu sau khi tải UI. Xóa nội dung để mở không proxy. Để trống API key vẫn giữ key đã lưu. Có thể kết nối CDP thủ công bằng địa chỉ localhost nếu không dùng luồng mở profile.

Tool nhận cổng CDP từ ProfileInUse khi đúng ID và cổng hợp lệ, chờ trình duyệt nhận kết nối tối đa 20 giây. Nếu cửa sổ đã mở thủ công chưa bật CDP, đóng profile rồi dùng nút mở của tool. Không cần nhập cổng mẫu 9222.

## Phiên và UI

Dừng extension trước khi chạy tool trong cùng profile. Tool dùng AutoRunner, DOM selector, AI lọc bài tiếng Việt ưu tiên mua sắm và lịch sử chống trùng của extension. Không dùng API Threads.

Lượt ảnh có 2 ảnh ngẫu nhiên + app_store.png ở giữa, gửi riêng lẻ. Lượt ảnh cách nhau 6–8 phút; giữa các lượt dùng chữ, mặc định không tag. Bật tùy chọn Tag @hoanxu.app rồi Lưu: sau mỗi 4 lượt bình luận có ảnh đã bấm gửi, lượt tiếp theo dùng chữ có tag một lần. Bộ đếm lưu riêng từng profile, giữ khi khởi động lại; lượt lỗi không tính. Ảnh bài gốc gửi AI gộp ngang tối đa 3 ảnh. Bộ mặc định có 13 ảnh. Folder tùy chỉnh cần app_store.png và ít nhất 2 ảnh khác, hỗ trợ PNG/JPEG/WebP, tối đa 200 file, 10 MB/file, 200 MB/folder.

Sau Post chờ 30–40 giây, về trang chủ, nghỉ mặc định 120–180 giây. Mỗi phiên 10 lần gửi rồi đóng tab Threads, nghỉ 3 giờ và mở tab tiếp tục. Giữ tab trống trước khi đóng tab cuối để bảo vệ cửa sổ. Stop hủy lịch tiếp theo.

UI có log trực tiếp, số lần gửi hôm nay theo múi giờ Việt Nam, tiến độ /10, tổng lần gửi, trạng thái chưa xác minh, lịch sử gần nhất và xuất toàn bộ lịch sử. Thống kê là lần gửi; sent_unverified không bảo đảm đã đăng thành công. Không tự gửi lại receipt có kết quả chưa rõ.

Prompt, chủ đề, nhịp gõ, chờ giữa bước, nghỉ tìm bài và khoảng nghỉ được lưu. Có thể nhập prompt từ .txt, chọn folder ảnh. UI giữ bản nháp khi cập nhật thống kê và khóa cấu hình khi chạy. Cache giữ tối đa 200 response AI khớp bài/model/prompt/loại lượt để giảm gọi lại khi khôi phục.

Prompt rating vẫn yêu cầu AI chấm đủ mọi bài đầu vào; GPM không kiểm tra số lượng hoặc báo lỗi nếu thiếu rating. Mỗi request AI rating hoặc viết comment chờ tối đa 90 giây. Mọi lỗi AI ở hai bước này đều nghỉ 2 phút rồi gọi lại, tối đa 3 lần gọi lại sau lần đầu (4 request cho bước đó). Nếu vẫn lỗi, phiên dừng và hiện nguyên nhân. Số lần gọi lại và mốc chờ được lưu để khôi phục; Stop hủy lần gọi tiếp theo.

Thả tim khi chờ mặc định bật, có thể tắt trong Nhịp chạy & chủ đề và lưu theo profile. Trong khoảng chờ trên trang chủ, chọn ngẫu nhiên 2–5 bài, cách nhau 20–45 giây; chỉ tương tác khi còn ít nhất 5 giây chờ. Bỏ qua bài của mình, nút Unlike và URL đã ghi nhận tương tác trước đó. Lịch sử ghi trước click để không tự thao tác lại khi kết quả chưa rõ; log ghi nhận lần bấm, không khẳng định nền tảng đã xử lý thành công. Không tương tác trong lúc comment, có bản nháp/hộp thoại hoặc nghỉ 3 giờ; Stop hủy lượt tiếp theo.

## Dữ liệu và kiểm thử

Giữ Node, GPM và máy hoạt động. Ctrl+C giữ checkpoint để mở lại; muốn hủy lịch, bấm Stop trước. Tool không đóng browser sau comment; chỉ thao tác cấu hình trước mở profile mới gọi stop khi cần. Mỗi profile dùng một data folder riêng; dashboard quản lý các process con. Có thể đặt GPM_TOOL_DATA cho thư mục riêng.

Key/proxy nằm trong data/tool.sqlite, bị loại khỏi Git và ZIP. Không chia sẻ file này. AI dùng kết nối mạng của Node; proxy profile chỉ áp dụng cho trình duyệt GPM.

```sh
npm run test:all
```

Kiểm thử dùng Chrome tạm và trang fixture, không đăng thật. TEST_CHROME cho phép chọn đường dẫn Chrome khác. ZIP không chứa node_modules; chạy npm ci trên máy mới.

API chính thức: https://github.com/GPMSoft/GPMLoginGlobalApiDocs/blob/main/docs/profiles.md

## Nhiều profile · 0.3.2

Phiên được tính riêng theo Profile ID: bộ đếm 10 lần gửi, lịch nghỉ 3 giờ, receipt chống trùng, response AI, lịch sử và log của mỗi profile nằm trong data/tool.sqlite, tách theo namespace profile:PROFILE_ID. Dữ liệu bản cũ được chuyển một lần cho profile đã chọn; không gán lịch sử đó sang profile khác.

Chọn một profile trong phần cài đặt, nhập proxy (hoặc để trống), lưu. Profile xuất hiện ở bảng Profile đã cấu hình / chạy. Lặp lại để thêm các profile khác. Bảng hiển thị proxy đầy đủ, trạng thái, số lần gửi của phiên, hôm nay/tổng và lượt tiếp theo. Xem log chọn profile đang hiển thị ở bảng thống kê phía trên; xuất lịch sử cũng lấy profile đang xem. Log có ghi lần mở/chạy và proxy tương ứng.

Tích nhiều profile rồi bấm Chạy các profile đã tích. Tool mở từng profile bằng cấu hình riêng và chạy đồng thời. Profile phải đăng nhập Threads trước khi chạy. Bấm Dừng trong hàng để dừng riêng; Dừng các profile đã tích dừng nhóm; Dừng tất cả dừng mọi profile. Start phía trên dùng profile đang chọn trong cài đặt. Không khởi động lại phiên của profile đã đang chạy khi bấm chạy nhóm lần nữa.

Mỗi profile sử dụng một process Node riêng để tránh dùng nhầm chrome adapter, tab hoặc phiên. Lỗi một profile không dừng các profile còn lại. Giữ process dashboard chạy để duy trì các bộ chạy; khi khởi động lại, lịch đang chạy được khôi phục theo từng profile. Nếu không kết nối được GPM, profile đó báo cần kiểm tra. Cấu hình mới áp dụng cho profile đã chọn, không sửa các profile đang chạy khác.

Bản này kiểm thử hai bộ chạy Node thật với dữ liệu riêng, kiểm thử Stop độc lập, hủy Start đang mở profile, di chuyển dữ liệu cũ và chọn nhiều profile trên UI. Chưa kiểm thử đăng thật đồng thời trên nhiều tài khoản GPM.

## Thêm mới profile · 0.3.2

Bấm + Thêm mới profile ở bảng quản lý. Nhập tên và proxy nếu cần, để trống proxy để tạo không proxy. Phiên bản Chrome để trống sẽ dùng phiên bản của profile Chrome đang chọn (hoặc profile đầu tiên khi chưa chọn); có thể nhập phiên bản đã cài trong GPM. Tạo profile dùng hệ điều hành máy chạy Node và nhóm mặc định của GPM.

Bấm Tạo profile: tool tạo profile mới trong GPM, thêm vào bảng quản lý, chọn profile đó và tạo dữ liệu phiên riêng. Chưa mở trình duyệt hay comment; bấm Áp dụng cấu hình & mở profile để đăng nhập Threads, sau đó Start hoặc chọn chạy nhóm.

## UI 0.3.2

Bỏ toàn bộ phần Kết nối profile & proxy khỏi Cài đặt. Thêm profile ở bảng quản lý; proxy được nhập trong form tạo mới và hiển thị ở bảng. Trong mỗi hàng, Mở mở profile để đăng nhập, Cài đặt tải prompt/nhịp chạy/ảnh của profile đó, Xem log chọn thống kê và lịch sử. Cài đặt phía dưới chỉ còn nhịp chạy, chủ đề, AI/prompt và ảnh. Cổng GPM/CDP được giữ trong cấu hình đã lưu và tự lấy khi mở profile.

### Đồng bộ GPM và dữ liệu lưu

Dashboard đọc GPM Local API mỗi 3 giây và đẩy cập nhật qua SSE. Tên, proxy hiện tại (kể cả proxy trống), nhóm, phiên bản browser, OS, tags và thời gian sửa của profile lấy từ GPM; đây là snapshot trong bộ nhớ, có `checkedAt`, `fresh` và lỗi đồng bộ. Khi API mất kết nối, thông tin lần cuối chỉ là cache và UI báo chưa đồng bộ. Profile mất khỏi GPM vẫn giữ lịch sử trong tool. Đồng bộ chỉ đọc, không gọi start/stop/update, không tự thêm profile vào phiên automation.

API Global v1 đang dùng không cung cấp trạng thái mở/đóng trong list/detail. Kết nối CDP lấy trực tiếp từ worker và phát sự kiện ngay khi mất kết nối; dashboard không suy diễn CDP ngắt nghĩa là GPM đã đóng. Profile mở thủ công nhưng tool chưa kết nối được hiển thị chưa xác định. Đây là polling 3 giây, không phải push từ GPM.

Dữ liệu bền vững: ID profile và GPM endpoint, cấu hình AI/runConfig/assets, cấu hình đã lưu của người dùng, lịch sử thao tác/receipts, chống trùng và checkpoint chạy/thử lại. Tên/proxy lưu là bản cấu hình/cache, không dùng làm nguồn xác nhận GPM. `cdp` và `browserTargets` lưu chỉ hỗ trợ khôi phục, không xác nhận profile đang mở. Token, kết nối, operation, view dashboard và snapshot realtime không lưu vào registry. View runtime cũ được loại bỏ khi khởi động. Nháp form không bị cập nhật SSE ghi đè.

Bấm Áp dụng & mở ở bảng và Start sẽ đọc proxy hiện tại từ GPM ngay trước khi mở, tránh ghi đè proxy đã đổi bên ngoài bằng cache cũ. Sửa tên/proxy là thao tác ghi rõ ràng qua Sửa profile.


Thả tim khi nghỉ dùng `runConfig.stepSeconds`: mỗi bước chờ `max(1.5 giây, stepSeconds)` cộng ngẫu nhiên 0–1.5 giây (mặc định 2–3.5 giây). Có chờ trước mỗi lần bấm Like. Kiểm tra Stop mỗi tối đa 100ms trong thời gian chờ và xác nhận lại nút trước khi bấm. Không đủ ngân sách thời gian cho toàn bộ luồng thì bỏ qua, không rút ngắn khoảng chờ. Khoảng cách giữa các bài vẫn 20–45 giây, ngẫu nhiên 2–5 bài trong một lượt nghỉ.

### Nhập danh sách profile đã có trong GPM

Bấm **Nhập danh sách profile** tại bảng profile. Chọn file JSON/CSV/TXT hoặc dán danh sách, bấm **Xem trước danh sách**, tích profile muốn thêm rồi **Nhập profile đã chọn**. Có thể bấm **Lấy danh sách từ GPM** để chọn trực tiếp mà không cần export file.

JSON hỗ trợ mảng `{id,name}`, chuỗi ID/tên, `profiles[]`, `data[]` và phản hồi API `data.data[]`. CSV có header `id`/`profile_id` hoặc `name`/`profile_name`, hỗ trợ dấu phẩy, chấm phẩy, tab, BOM và giá trị có dấu nháy. TXT mỗi dòng một ID hoặc tên. Tối đa 1 MB / 500 dòng mỗi lần. File Excel hoặc gói backup profile chưa được nhập bằng luồng này.

Ưu tiên đối chiếu ID với GPM; nếu chỉ có tên, cần khớp duy nhất. ID không tìm thấy không tự chuyển sang profile cùng tên. Trùng trong file, đã có trong tool, không tìm thấy và tên trùng được báo ở phần xem trước. Xác nhận sẽ đọc lại GPM và dùng tên/proxy hiện tại (kể cả proxy trống), không ghi proxy trong file lên GPM. Preview hết hạn sau 5 phút; import lại bỏ qua profile đã có.

Profile mới dùng bản cấu hình AI, runConfig và ảnh đã lưu của cài đặt đang chọn, với lịch sử riêng. Nháp chưa lưu không được áp dụng. Nhập chỉ lưu cấu hình vào tool, không tạo/sửa/mở/đóng profile GPM và không khởi động worker hay phiên. Dữ liệu của profile đã cấu hình, profile đang chạy và lịch sử cũ được giữ nguyên. Nếu thêm lại ID đã bỏ khỏi bảng trước đây, giữ dữ liệu riêng đã lưu của ID đó.
