# Tự cấu hình key

Dự án dùng một API key AI cho dịch vụ `https://vps.hoanxu.com/v1`. Key chưa mã hoá không được nằm trong code, EXE hoặc DMG.

## Key đi kèm app, mở bằng mật khẩu

App macOS có sẵn key đã mã hoá trong `gpm-tool/bundled-key.enc.json` (scrypt + AES-256-GCM). Repository và DMG chỉ chứa file mã hoá này. Lần đầu mở app trên một máy, app hỏi **mật khẩu mở app**; nhập đúng thì key được giải mã và lưu vào SQLite trên máy, các lần sau không hỏi lại. Khi chưa mở khoá, tool chặn chạy profile, chạy thử và tải model.

Mật khẩu không nằm trong repository. Vì file mã hoá được công khai, nên dùng mật khẩu dài và khó đoán.

Đổi key hoặc mật khẩu: điền key mới vào `gpm-tool/.env`, rồi chạy từ thư mục `gpm-tool`:

```sh
node --env-file=.env tools/encrypt-key.mjs
```

Script hỏi mật khẩu 2 lần (hoặc đọc biến `HOANXU_KEY_PASSWORD`) rồi ghi lại `bundled-key.enc.json` với mã nhận dạng mới. Commit file này và phát hành bản mới; mỗi máy sẽ được hỏi mật khẩu 1 lần sau khi cập nhật. App Windows chưa có màn hình nhập mật khẩu nên bản Windows chưa đóng gói file này.

## Nhập key trong app

Mở **Cài đặt chung**, điền **API key**, chọn model rồi bấm **Lưu cho tất cả profile** nếu muốn dùng key khác key đi kèm. Để trống ô key khi sửa các cài đặt khác sẽ giữ key đã lưu. Extension có ô API key riêng trong giao diện cấu hình.

Key của app được lưu cục bộ trong SQLite tại:

- macOS: `~/Library/Application Support/HoanXu-GPM/data/tool.sqlite`
- Windows: `%LOCALAPPDATA%\HoanXu-GPM\data\tool.sqlite`
- Chạy từ source: `gpm-tool/data/tool.sqlite`, trừ khi đặt `GPM_TOOL_DATA`.

## Tự đặt biến môi trường

Backend và app native đọc biến `HOANXU_API_KEY` khi khởi động. Biến chỉ bổ sung key nếu chưa có key đã lưu. Khởi chạy app từ terminal đã đặt biến nếu dùng cách này; mở app bằng Finder không mặc định nhận biến của shell.

Khi chạy từ source, sao chép `gpm-tool/.env.example` thành `gpm-tool/.env`, điền key trong `.env`, rồi chạy từ thư mục `gpm-tool`:

```sh
node --env-file=.env server.mjs
```

Không điền key thật vào `.env.example`. `.env` và thư mục dữ liệu được Git bỏ qua.

## Các kết nối khác

| Kết nối | Cần key? | Cấu hình |
| --- | --- | --- |
| GPM Local API | Không | Nhập URL/cổng trong Cài đặt chung |
| CDP của trình duyệt GPM | Không | Tool lấy khi mở profile |
| Proxy có xác thực | Có username/password nếu nhà cung cấp yêu cầu | Nhập riêng cho từng profile |
| GitHub Actions tạo release | `GITHUB_TOKEN` do GitHub tự cấp | Không cần tự điền token vào code |
| Cập nhật từ xa trong app | Không | Đọc GitHub Releases công khai; không lưu GitHub token |

## Chuẩn bị repository công khai

Commit source, `.env.example` và `gpm-tool/bundled-key.enc.json` (chỉ chứa key đã mã hoá). Không commit `.env`, thư mục `data`, SQLite, cookie, file export phiên Threads, `.build` hoặc `release`. Bản EXE cũ từng build bằng key nhúng chưa mã hoá phải giữ riêng và không upload lại.
