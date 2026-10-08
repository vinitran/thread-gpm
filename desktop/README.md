# Giao diện desktop native

Từ phiên bản 0.4.0, hai giao diện dùng control của hệ điều hành:

- macOS Apple Silicon: Swift/AppKit, source `macos/Desktop.swift`, entry point `macos/main.swift`; lifecycle và helper cập nhật ở `../packaging/macos/Launcher.swift`.
- Windows x64: C#/WPF, source `windows/`; .NET 10 được publish self-contained trong EXE portable.

App tự chạy backend Node.js đóng gói trên cổng loopback còn trống. Không mở web UI hay dùng WebView. Backend `gpm-tool` vẫn quản lý GPM, AI, automation, lịch sử, import phiên Threads và cập nhật; giao diện không tự đăng Threads ngoài các API hiện có.

Dữ liệu nằm trong `data/tool.sqlite`, ngoài thư mục app; mỗi profile có namespace riêng. Lần đầu dùng tự chuyển JSON cũ, giữ bản `state.pre-sqlite.json`. SQLite dùng transaction, WAL và schema version; database của phiên bản mới hơn sẽ bị từ chối bởi app cũ thay vì reset. Sao lưu bằng cách thoát app rồi copy toàn bộ thư mục data.

POST gửi Origin và token lấy từ `/api/state`; token hết hiệu lực được lấy lại một lần. App tự kiểm tra GitHub Releases khi mở và mỗi giờ, có nút kiểm tra ở đầu cửa sổ. Khi có bản mới, banner và nút Cập nhật & mở lại hiện trên mọi tab. Kiểm tra thất bại không khẳng định đang ở bản mới nhất.

Nhật ký/trạng thái được lấy mỗi 2 giây; backend đồng bộ metadata GPM mỗi 3 giây. Chỉ cập nhật bảng khi nội dung thay đổi, giữ chọn profile và bản nháp cài đặt khi polling.

Cài đặt chung gửi `scope: all`. Bấm Lưu áp dụng cho các profile hiện có và cấu hình mặc định của profile mới; lượt AI/comment đang xử lý hoàn tất với cấu hình đã bắt đầu. Mở chỉ mở GPM. Dừng gọi API đóng GPM và hủy các lượt mở còn chờ.

Nhập danh sách/phiên có preview và xác nhận; đổi bộ lọc sẽ hủy preview cũ. Import lớn chia batch 500. Xuất danh sách chỉ giữ ID/tên; xuất chuyển máy có thông tin đăng nhập, dùng luồng backend hiện có.

Windows thoát backend bằng `/api/app-quit` có kiểm tra Origin/token để lưu checkpoint; Mac dùng SIGTERM. Đóng cửa sổ Mac vẫn giữ app ở menu bar; ⌘Q thoát. Windows đóng cửa sổ thoát app, hỏi nếu còn profile đang chạy. Nên Dừng & đóng trước để đóng cả GPM.

Build, CI, cập nhật và hướng dẫn sử dụng: xem `../packaging/README.md`, `../packaging/macos/HUONG-DAN-MAC.md`, `../packaging/windows/HUONG-DAN-WINDOWS.md`.

Kiểm thử trên Mac sử dụng thư mục data và GPM giả lập riêng. CI Windows chạy `HoanXuDesktop.exe --smoke-test` với data tạm, kiểm tra lưu cài đặt và thoát sạch, không dùng tài khoản thật. Chưa chạy WPF trực tiếp trên Mac.
