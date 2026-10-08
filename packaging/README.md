# Build local và CI/CD

Từ 0.4.0, giao diện macOS dùng Swift/AppKit và Windows dùng C#/WPF, không dùng WebView. Backend Node.js được đóng gói và chạy ẩn. Tool luôn chạy trên máy người dùng, kết nối GPM Local API trên máy đó. Không có web server từ xa. GitHub Actions chỉ build; GitHub Releases chứa file cài và thông tin phiên bản để app kiểm tra cập nhật.

## Push để tự build

Workflow `.github/workflows/build-desktop.yml` chạy khi push bất kỳ branch nào hoặc bấm **Actions → Build local desktop apps → Run workflow**. Nó bỏ qua các bước test theo cấu hình hiện tại và build 2 bản: DMG Mac Apple Silicon (arm64), EXE Windows x64 portable.

Vào **GitHub → Actions → lần chạy → Artifacts**, tải `HoanXu-mac-arm64` hoặc `HoanXu-win-x64`, giải nén rồi dùng DMG/EXE. Artifact giữ 14 ngày. Push branch không tạo bản cập nhật cho người dùng hiện tại.

## Tự phát hành mỗi lần push main

Mỗi push lên `main` tự build Mac arm64 và Windows x64 rồi tạo GitHub Release stable. Không cần tạo tag thủ công. CI chọn patch version chưa phát hành trong cùng dòng major/minor, cập nhật package và lockfile trong thư mục build; không tạo commit version ngược vào source. Ví dụ source 0.4.1 đã có Release v0.4.1 thì push tiếp tạo v0.4.2.

Hai bản dùng cùng version; chỉ phát hành khi cả hai build thành công. Các lượt chạy được xếp hàng để tránh trùng phiên bản. Push branch khác và Run workflow thủ công chỉ tạo Artifacts. Push tag `vX.Y.Z` vẫn phát hành theo version trong source. Chạy lại job đã có Release không ghi đè file đã phát hành.

App dùng manifest trong Releases để hiện cảnh báo bản mới và cho bấm cập nhật. Cập nhật thay app/EXE, giữ SQLite ở thư mục data ngoài app.

Tag sai version bị chặn trước khi phát hành. Repo cập nhật được đóng gói theo `${GITHUB_REPOSITORY}` trong CI; build trên máy có thể đặt `GPM_UPDATE_REPOSITORY=owner/repo`. Phát hành stable dùng số `x.y.z`; chưa hỗ trợ prerelease.

Repo private vẫn build được và chủ repo tải Artifact sau khi đăng nhập GitHub. Cập nhật trong app hiện đọc Releases public, không lưu GitHub token. Nếu muốn giữ source private và cập nhật không đăng nhập, dùng một repo public riêng để phát hành binary, đặt `GPM_UPDATE_REPOSITORY` trỏ đến repo đó và chỉnh job release tới repo đích với token có quyền tương ứng.

## Tự cấu hình API key

Bản build không nhúng API key. Điền key trong **Cài đặt chung → API key → Lưu cho tất cả profile**, hoặc đặt biến môi trường `HOANXU_API_KEY` trước khi khởi chạy backend/app. Biến này chỉ bổ sung khi chưa có key đã lưu; không thay key riêng có sẵn. Key được lưu trong SQLite trên máy người dùng, ngoài thư mục app và không thuộc Git.

CI chỉ dùng `GITHUB_TOKEN` do GitHub cấp để tạo release. Không cần secret AI trong Actions. Không đưa `.env`, SQLite, file export phiên Threads hay bản build cũ đã nhúng key vào repository.

Cập nhật từ xa hiện tắt theo cấu hình; CI vẫn build và tạo release để tải thủ công.
