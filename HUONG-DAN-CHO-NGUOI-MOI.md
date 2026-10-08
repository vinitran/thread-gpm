# Hướng dẫn cài đặt và sử dụng cho người mới

Tải app, mở GPM, nhập key AI, thêm profile, mở Threads kiểm tra đăng nhập rồi mới chạy tự động.

## 1. Chuẩn bị và tải app

Bạn cần GPM đã cài trên máy, tài khoản Threads của mình và API key dùng được tại `https://ai.hoanxu.com/v1`. Nhập key được cấp riêng cho bạn hoặc key của bạn; file app không có key sẵn.

Mở [trang tải bản mới nhất](https://github.com/vinitran/thread-gpm/releases/latest), chọn file phù hợp trong **Assets**:

| Máy | File tải | Cách mở |
| --- | --- | --- |
| Mac dùng chip Apple Silicon | `HoanXu-GPM-…-mac-arm64.dmg` | Mở DMG, kéo **HoanXu GPM.app** vào **Applications**, rồi mở app từ Applications |
| Windows 64-bit | `HoanXu-GPM-…-win-x64-portable.exe` | Lưu EXE vào thư mục có quyền ghi rồi mở; không cần cài đặt |

Không cần cài Node.js hoặc .NET khi dùng bản đã đóng gói. Bản Mac yêu cầu macOS 12 trở lên, không hỗ trợ Mac Intel. Bản Windows hỗ trợ x64.

## 2. Kết nối GPM

1. Mở GPM và đăng nhập nếu GPM yêu cầu.
2. Trong cài đặt GPM, tìm địa chỉ **Local API** đang sử dụng.
3. Mở tool → **Cài đặt chung**, nhập địa chỉ đó vào **GPM Local API**.
4. Bấm **Kiểm tra / tìm GPM**. Nếu tool tìm được địa chỉ khác, bấm **Lưu cho tất cả profile** để áp dụng.

Hai địa chỉ thường gặp:

- GPM Global: `http://127.0.0.1:9495/api/v1`
- GPMLogin v4: `http://127.0.0.1:19995/api/v3`

Dùng địa chỉ hiển thị trong GPM nếu cổng trên máy khác các ví dụ. Tool và GPM phải chạy trên cùng máy. GPM Local API không yêu cầu API key AI.

## 3. Nhập API key và cài đặt AI

1. Trong **Cài đặt chung**, dán key vào ô **API key**.
2. Giữ model mặc định nếu key của bạn hỗ trợ, hoặc nhập tên model được cấp quyền dùng.
3. Bấm **Lưu cho tất cả profile**, sau đó **Tải model…** để xem các model mà key đã lưu có thể truy cập.
4. Chọn model mong muốn rồi lưu lại.
5. Chỉnh **Chủ đề muốn tìm**, **Hướng dẫn cho AI**, **Nghỉ trung bình**, thời gian gõ và thời gian chờ giữa thao tác theo nhu cầu.

**Lưu cho tất cả profile** áp dụng model, prompt và nhịp chạy từ bước tiếp theo. Lượt AI hoặc bình luận đang thực hiện sẽ hoàn tất. Khi đổi địa chỉ GPM, hãy dừng các profile đang chạy trước.

Để trống ô API key khi sửa cài đặt khác sẽ giữ key đã lưu. Nếu cần tự cấu hình bằng biến môi trường hoặc chạy từ source, xem [hướng dẫn cấu hình key](CAU-HINH-KEY.md).

## 4. Thêm profile và proxy

### Dùng profile đã có trong GPM

1. Vào **Profile → Từ GPM…**.
2. Tìm theo tên hoặc ID; chọn nhóm để thu hẹp danh sách.
3. Chọn các profile muốn dùng rồi xác nhận thêm vào tool.

Việc thêm profile vào bảng chưa chạy tự động. Nếu danh sách quá dài, dùng tên/nhóm để lọc; mỗi lần xem trước hiển thị tối đa 500 kết quả.

### Tạo profile mới

1. Vào **Profile → Tạo mới…**.
2. Nhập tên dễ nhận biết.
3. Điền proxy nếu dùng, hoặc để trống.
4. Nếu được yêu cầu, nhập đúng phiên bản Chrome đã có trong GPM rồi tạo.

### Sửa proxy cho profile

Chọn một profile → **Sửa tên / proxy…**. Dùng thông tin do nhà cung cấp proxy cấp. Các định dạng được hỗ trợ, với dữ liệu ví dụ:

```text
192.0.2.10:8080:USERNAME:PASSWORD
socks5://192.0.2.10:1080:USERNAME:PASSWORD
http://USERNAME:PASSWORD@192.0.2.10:8080
```

Để trống để mở không proxy. Dừng profile trước khi thay proxy. Tool dùng proxy hiện có trong GPM khi mở profile.

## 5. Mở và chạy

1. Bấm vào dòng profile để chọn; bấm lại để bỏ chọn.
2. Bấm **Mở trình duyệt**. Nút này mở profile GPM và kết nối trình duyệt, chưa chạy automation.
3. Trong trình duyệt GPM, mở Threads và tự đăng nhập. Đóng các popup còn mở, về trang chủ và chờ bài viết tải xong.
4. Có thể chọn một profile và bấm **Chạy thử · không đăng** để đọc các bài đang hiển thị, gọi AI và xem bản nháp. Lượt này không gửi comment hoặc thả tim, nhưng có gọi dịch vụ AI bằng key của bạn.
5. Khi đã sẵn sàng, chọn các profile rồi bấm **Chạy tự động**. Chế độ này có thể đăng bình luận thật. Tùy chọn **Thả tim khi chờ** nằm trong Cài đặt chung.
6. Xem **Nhật ký & lịch sử** để theo dõi. Muốn kết thúc, chọn profile rồi bấm **Dừng & đóng** để gửi lệnh đóng tới GPM.

Chỉ dùng các tài khoản và bài viết bạn được phép thao tác.

## 6. Cập nhật app

Từ bản 0.4.3, app đọc bản mới từ GitHub Releases công khai. App kiểm tra khi mở và định kỳ; bạn cũng có thể bấm **Kiểm tra cập nhật** ở đầu cửa sổ.

Khi có cảnh báo bản mới: lưu các cài đặt đang sửa, dừng profile rồi bấm **Cập nhật & mở lại**. App thay bộ file chương trình và giữ dữ liệu ở thư mục riêng.

Nếu đang dùng bản 0.4.2 đã tắt cập nhật, hãy tải bản mới từ trang Releases và thay app thủ công một lần. Trên Mac, chạy app từ Applications để cập nhật được.

## 7. Chuyển máy và dữ liệu

**Xuất / chuyển máy…** có hai mục đích:

- Xuất danh sách: chỉ có ID/tên; máy nhận phải có profile tương ứng trong GPM.
- Chuyển kèm phiên Threads: cần mở profile nguồn; gói chuyển có dữ liệu đăng nhập và proxy. Chỉ chuyển riêng tới máy/người được phép sử dụng tài khoản đó.

Ở máy nhận, dùng **Nhập file…**, xem trước rồi xác nhận. Máy nhận tự nhập API key của mình; file chuyển profile không kèm key AI.

Dữ liệu app nằm tại:

- Mac: `~/Library/Application Support/HoanXu-GPM/data`
- Windows: `%LOCALAPPDATA%\HoanXu-GPM\data`

Muốn sao lưu, thoát app rồi sao chép cả thư mục data. Không đưa thư mục data, `.env` hoặc file chuyển phiên lên repo công khai.

## 8. Lỗi thường gặp

| Thông báo | Cách xử lý |
| --- | --- |
| Không kết nối được GPM Local API | Mở GPM; kiểm tra địa chỉ/cổng; dùng **Kiểm tra / tìm GPM** rồi lưu |
| Không thấy profile | Kiểm tra đúng GPM trên máy, từ khóa và nhóm đang chọn |
| CDP chưa kết nối | Chọn profile và bấm **Mở trình duyệt**; đọc lỗi kèm theo nếu không mở được |
| Không xác nhận được đăng nhập Threads | Mở profile, tự đăng nhập Threads và đóng popup |
| Tab nguồn không ở trang chủ | Đưa tab Threads về trang chủ, chờ tải xong rồi thử lại |
| AI HTTP 401/403 | Kiểm tra key và quyền truy cập dịch vụ/model |
| AI timeout | Kiểm tra kết nối và model; automation chờ 120 giây trước khi thử lại, tối đa 3 lần sau lần gọi đầu |
| Không tải được cập nhật | Kiểm tra mạng; tải bản mới thủ công từ Releases nếu cần |

Khi gửi lỗi cho người hỗ trợ, gửi tên phiên bản và thông báo lỗi; che API key, mật khẩu proxy và dữ liệu đăng nhập.
