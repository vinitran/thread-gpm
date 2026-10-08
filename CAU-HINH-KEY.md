# Tự cấu hình key

Dự án cần một API key AI cho dịch vụ `https://ai.hoanxu.com/v1`. Key không được nhúng trong code, EXE hoặc DMG.

## Cách dễ nhất: nhập trong app

Mở **Cài đặt chung**, điền **API key**, chọn model rồi bấm **Lưu cho tất cả profile**. Để trống ô key khi sửa các cài đặt khác sẽ giữ key đã lưu. Extension có ô API key riêng trong giao diện cấu hình.

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

Commit source và `.env.example`. Không commit `.env`, thư mục `data`, SQLite, cookie, file export phiên Threads, `.build` hoặc `release`. Các bản build mới không có cơ chế nhúng key; bản EXE cũ từng build bằng key nhúng phải giữ riêng và không upload lại.
