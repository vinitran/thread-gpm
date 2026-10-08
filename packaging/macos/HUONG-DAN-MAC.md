# Hoàn Xu GPM trên macOS

1. Mở file DMG, kéo **HoanXu GPM.app** vào **Applications**.
2. Mở app từ Applications. App đã kèm Node.js; không cần Terminal hay npm. Giao diện native Swift/AppKit mở trực tiếp trong cửa sổ app; backend chạy ẩn, không cần trình duyệt.
3. Mở GPMLogin Global. Trong tool, vào **Cài đặt chung**, nhập đúng Local API ở cài đặt GPM rồi lưu.
4. **Profile → Từ GPM…** hoặc **Tạo mới**. Chọn profile → **Mở trình duyệt** để kiểm tra đăng nhập Threads. Sau đó lưu cài đặt và **Chạy tự động**.
5. Đóng cửa sổ app vẫn giữ tool ở menu bar. Chọn profile rồi bấm **Dừng & đóng** khi muốn kết thúc; dùng **⌘Q** hoặc menu app để thoát.

Yêu cầu macOS 12 trở lên và GPM được cài riêng. Bản Mac chỉ hỗ trợ Apple Silicon (M1/M2/M3/M4…) với kiến trúc arm64. App tự chọn cổng local còn trống.

## Dữ liệu và cập nhật

Dữ liệu nằm tại `~/Library/Application Support/HoanXu-GPM/data`; cookie và dữ liệu trình duyệt vẫn do GPM quản lý. App không tự sao chép cấu hình của bản chạy từ source. Có thể dùng **Xuất / Chuyển máy** ở bản cũ rồi nhập trong app mới.

Trong tab **Cài đặt chung**, nút **Kiểm tra cập nhật** lấy bản mới từ GitHub Releases đã cấu hình lúc build. App cũng kiểm tra một lần khi mở app. Dừng các profile, lưu các cài đặt đang sửa rồi bấm **Cài bản mới & mở lại**. Tool xác minh kích thước, SHA-256, chữ ký và phiên bản app trước khi thay file; thư mục dữ liệu không bị thay. App đang chạy trực tiếp từ DMG cần được kéo vào Applications trước.

Nếu chưa có release, repo private hoặc không có mạng, app vẫn chạy local; kiểm tra cập nhật sẽ báo nguyên nhân. Bản hiện tại dùng release public để cập nhật mà không lưu GitHub token trên máy người dùng. Một repo public riêng chỉ chứa các file build cũng dùng được, source có thể giữ private.

Nếu cập nhật không hoàn tất, xem `update-error.txt` và `app.log` trong thư mục dữ liệu. Có thể tải DMG mới và thay app thủ công; dữ liệu giữ nguyên.

Bản build mặc định dùng chữ ký ad-hoc, chưa có Developer ID/notarization. macOS có thể chặn app tải từ mạng; dùng phần **Privacy & Security → Open Anyway** nếu bạn tin tưởng bản phát hành. Không cần tắt Gatekeeper. Để phát hành app đã xác minh bởi Apple, cấu hình Developer ID và notarization theo README đóng gói.

Từ 0.4.1, app kiểm tra bản mới lúc mở và mỗi giờ. Nút **Kiểm tra cập nhật** có ngay đầu cửa sổ; khi có bản mới sẽ hiện cảnh báo **Bạn chưa dùng phiên bản mới nhất** cùng nút **Cập nhật & mở lại**, không cần vào Cài đặt. Không tự cài bản mới khi đang chạy profile.

Cài đặt, lịch sử và trạng thái chạy được lưu trong `tool.sqlite` ở thư mục data ngoài app. JSON cũ được tự chuyển một lần và giữ bản sao `state.pre-sqlite.json` tại vị trí cũ. Cập nhật chỉ thay app, không xóa database. Khi sao lưu, thoát app trước rồi copy toàn bộ thư mục data; không chỉ copy database trong lúc app đang chạy. Không dùng app 0.4.0 trở về trước để ghi vào dữ liệu đã chuyển SQLite.

## Kiểm tra kết nối GPM

Mở GPM, vào **Cài đặt chung → Kiểm tra / tìm GPM**. App thử địa chỉ đã nhập, rồi hai cổng phổ biến 9495 (Global/API v1) và 19995 (v4/API v3). Nếu tìm được địa chỉ khác, bấm **Lưu cho tất cả profile** để áp dụng. Với cổng tùy chỉnh, nhập địa chỉ đúng trong Cài đặt GPM trước khi kiểm tra. Dừng các profile đang chạy trước khi đổi địa chỉ GPM; đổi AI và nhịp chạy vẫn áp dụng từ bước tiếp theo.

Bản 0.4.2 tắt cập nhật từ xa vì repository riêng tư. CI vẫn tạo bản release; đăng nhập GitHub để tải thủ công. **Chạy thử · không đăng** kiểm tra Threads và AI, chỉ tạo bản xem trước, không gửi comment hoặc thả tim.
