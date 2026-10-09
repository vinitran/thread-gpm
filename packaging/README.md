# Build local và CI/CD

Từ 0.4.0, giao diện macOS dùng Swift/AppKit và Windows dùng C#/WPF, không dùng WebView. Backend Node.js được đóng gói và chạy ẩn. Tool luôn chạy trên máy người dùng, kết nối GPM Local API trên máy đó. Không có web server từ xa. GitHub Actions build và phát hành; GitHub Releases chứa file cài và thông tin phiên bản để app kiểm tra cập nhật.

## Push để tự build

Workflow `.github/workflows/build-desktop.yml` chạy khi push bất kỳ branch nào hoặc bấm **Actions → Build local desktop apps → Run workflow**. Nó bỏ qua các bước test theo cấu hình hiện tại và build 2 bản: DMG Mac Apple Silicon (arm64), EXE Windows x64 portable.

Vào **GitHub → Actions → lần chạy → Artifacts**, tải `HoanXu-mac-arm64` hoặc `HoanXu-win-x64`, giải nén rồi dùng DMG/EXE. Artifact giữ 14 ngày. Push branch không tạo bản cập nhật cho người dùng hiện tại.

## Tự phát hành mỗi lần push main

Mỗi push lên `main` tự build Mac arm64 và Windows x64 rồi tạo GitHub Release stable. Không cần tạo tag thủ công. CI chọn patch version chưa phát hành trong cùng dòng major/minor, cập nhật package và lockfile trong thư mục build; không tạo commit version ngược vào source. Ví dụ source 0.4.1 đã có Release v0.4.1 thì push tiếp tạo v0.4.2.

Hai bản dùng cùng version nhưng build/phát hành độc lập trong `build-macos.yml` và `build-windows.yml`. Workflow điều phối chọn version và tạo draft release chung. Nền tảng nào build xong trước sẽ upload binary, checksum, manifest rồi công khai release ngay; nền tảng còn lại bổ sung file khi xong, kể cả khi bên kia build lỗi. Các lượt chạy được xếp hàng để tránh trùng phiên bản. Push branch khác và Run workflow thủ công chỉ tạo Artifacts. Push tag `vX.Y.Z` vẫn phát hành theo version trong source. Chạy lại job giữ nguyên bộ file đã upload đầy đủ; nếu lượt upload trước bị dở dang, chỉ sửa bộ file của nền tảng đó và upload manifest cập nhật cuối cùng.

App tự kiểm tra cập nhật khi mở và mỗi phút, đồng thời có nút kiểm tra thủ công. App đọc danh sách Releases để chọn phiên bản stable mới nhất có manifest đúng nền tảng, rồi tải manifest qua URL của tag cụ thể; không phụ thuộc redirect `latest/download` có thể còn trỏ về bản cũ khi một nền tảng vừa phát hành. Nếu release mới chưa có file cho nền tảng đang dùng, app dùng release stable gần nhất có manifest đúng nền tảng. Khi GitHub API không truy cập được hoặc giới hạn lượt gọi, app thử đường dẫn tải latest làm phương án dự phòng. Cập nhật thay app/EXE, giữ SQLite ở thư mục data ngoài app.

Tag sai version bị chặn trước khi phát hành. Repo cập nhật được đóng gói theo `${GITHUB_REPOSITORY}` trong CI; build trên máy có thể đặt `GPM_UPDATE_REPOSITORY=owner/repo`. Phát hành stable dùng số `x.y.z`; chưa hỗ trợ prerelease.

Repo private vẫn build được và chủ repo tải Artifact sau khi đăng nhập GitHub. Cập nhật trong app hiện đọc Releases public, không lưu GitHub token. Nếu muốn giữ source private và cập nhật không đăng nhập, dùng một repo public riêng để phát hành binary, đặt `GPM_UPDATE_REPOSITORY` trỏ đến repo đó và chỉnh job release tới repo đích với token có quyền tương ứng.

## Tự cấu hình API key

Bản build không nhúng API key. Điền key trong **Cài đặt chung → API key → Lưu cho tất cả profile**, hoặc đặt biến môi trường `HOANXU_API_KEY` trước khi khởi chạy backend/app. Biến này chỉ bổ sung khi chưa có key đã lưu; không thay key riêng có sẵn. Key được lưu trong SQLite trên máy người dùng, ngoài thư mục app và không thuộc Git.

CI chỉ dùng `GITHUB_TOKEN` do GitHub cấp để tạo release. Không cần secret AI trong Actions. Không đưa `.env`, SQLite, file export phiên Threads hay bản build cũ đã nhúng key vào repository.

Cập nhật từ xa được bật cho GitHub Releases công khai. App kiểm tra khi mở và định kỳ, hiện cảnh báo khi có bản mới, cài khi người dùng bấm nút. Có thể build với `GPM_UPDATES_ENABLED=0` để tắt.
