# Quy tắc làm việc trong dự án

## Tự động đẩy code và phát hành

- Sau mỗi lần cập nhật tính năng, sửa lỗi hoặc chỉnh tài liệu, thực hiện kiểm tra phù hợp với thay đổi, rồi tự commit và push lên GitHub. Người dùng đã cho phép quy trình này; không hỏi lại xác nhận cho mỗi lần đẩy code.
- Repository chính là `git@github.com:vinitran/thread-gpm.git`. Nhánh phát hành là `main`. Không đẩy sang repository cũ `thread-tool`.
- Kiểm tra working tree trước khi commit; chỉ đưa vào commit những thay đổi thuộc công việc đang thực hiện. Không commit API key, thông tin đăng nhập, dữ liệu profile hoặc file build. Không ghi đè thay đổi của người dùng, không force-push.
- Push lên `main` sẽ kích hoạt `.github/workflows/build-desktop.yml`, tự chọn phiên bản và phát hành GitHub Release khi build macOS Apple Silicon và Windows x64 đều thành công. Dùng quy trình CI này, không tạo release hoặc tag trùng thủ công.
- Theo dõi workflow ứng với đúng commit vừa push đến khi hoàn tất. Nếu build hoặc phát hành lỗi, đọc log, sửa nguyên nhân trong phạm vi công việc và push lại. Nếu bị chặn bởi quyền truy cập hay dịch vụ bên ngoài, báo rõ nguyên nhân và trạng thái còn dang dở.
- Trước khi báo đã release, xác nhận release thuộc commit vừa push và có đủ DMG macOS arm64, EXE Windows x64 cùng manifest/checksum cập nhật mà workflow tạo ra. Gửi link release cho người dùng. Không coi push thành công là release thành công.
- Giữ CI chỉ build/phát hành, không thêm bước chạy test vào CI nếu người dùng chưa yêu cầu. Chạy kiểm tra phù hợp ở local; không chạy profile GPM thật hoặc đăng bình luận để kiểm thử khi chưa có yêu cầu mới.
- Nếu người dùng chỉ yêu cầu giải thích hoặc kiểm tra mà không có thay đổi file thì không tạo commit rỗng. Chỉ dẫn cụ thể mới hơn của người dùng (ví dụ không push hoặc không release) được ưu tiên.
