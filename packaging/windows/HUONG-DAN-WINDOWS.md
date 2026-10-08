# Hoàn Xu GPM native trên Windows x64

1. Cài và mở GPMLogin. Tải `HoanXu-GPM-0.4.3-win-x64-portable.exe` vào thư mục bạn có quyền ghi, rồi mở file. Không cần cài Node.js hoặc .NET.
2. App mở cửa sổ WPF native; backend chạy ẩn. Vào **Cài đặt chung**, nhập GPM Local API và bấm **Lưu cho tất cả profile**. GPMLogin v4 thường dùng `http://127.0.0.1:19995/api/v3`; Global dùng địa chỉ trong Cài đặt GPM.
3. Tab **Profile → Từ GPM…**: tìm theo tên/ID, chọn nhóm, tích các dòng hợp lệ rồi thêm. Mỗi truy vấn tối đa 500 kết quả; dùng bộ lọc để thu hẹp. **Tạo mới…** tạo profile GPM. Chọn một profile → **Sửa tên / proxy…** để chỉnh proxy; để trống nếu không dùng proxy.
4. Bấm dòng profile để chọn/bỏ chọn, rồi **Mở trình duyệt** để kiểm tra đăng nhập Threads. Nút này chỉ mở GPM, chưa chạy tự động.
5. Trong **Cài đặt chung**, chọn model, API key, chủ đề, prompt và nhịp chạy rồi **Lưu cho tất cả profile**. Thay đổi áp dụng cho tất cả profile từ bước tiếp theo; lượt đang làm sẽ hoàn tất. Bản EXE mới không chứa API key, proxy hay lịch sử của máy phát triển; cần nhập cấu hình của bạn.
6. Chọn profile rồi **Chạy tự động**. Tab **Nhật ký & lịch sử** xem tiến trình; bỏ chọn để xem nhật ký tất cả. **Dừng & đóng** gửi lệnh dừng tới GPM.
7. Đóng cửa sổ để thoát app. App cảnh báo nếu còn profile đang chạy; nên dừng profile trước. Mở EXE lần nữa sẽ đưa cửa sổ hiện tại lên trước.

## Xuất, nhập và chuyển máy

**Xuất / chuyển máy…** xuất profile đã chọn (hoặc tất cả nếu chưa chọn). Xuất danh sách chỉ lưu ID/tên; máy đích cần có profile tương ứng trong GPM. Chuyển kèm phiên Threads yêu cầu mở profile nguồn và xuất cookie/phiên đăng nhập; file chứa dữ liệu đăng nhập riêng tư. Trên máy đích dùng **Nhập file…**, đối chiếu và chọn các profile muốn nhập. Nhập không tự chạy automation.

## Dữ liệu và cập nhật

Cấu hình và lịch sử ở `%LOCALAPPDATA%\HoanXu-GPM\data`. Cookie trình duyệt do GPM quản lý. Thay EXE không xóa data; bản native dùng cùng thư mục với bản portable cũ. App tự chọn cổng local còn trống, không cần mở console.

**Cài đặt chung → Kiểm tra cập nhật** đọc GitHub Releases. Dừng profile và lưu cài đặt trước khi **Cài bản mới & mở lại**. Tool kiểm tra checksum và EXE x64, thay EXE rồi mở lại; giữ nguyên data. Nếu lỗi, xem `app.log` / `update-error.txt` trong thư mục data hoặc tải EXE mới thủ công.

CI build bản Windows x64; các bước test trong CI đang tắt theo cấu hình hiện tại. EXE chưa ký số.

Từ 0.4.1, app kiểm tra bản mới lúc mở và mỗi giờ. Nút **Kiểm tra cập nhật** có ngay đầu cửa sổ; khi có bản mới sẽ hiện cảnh báo **Bạn chưa dùng phiên bản mới nhất** cùng nút **Cập nhật & mở lại**, không cần vào Cài đặt. Không tự cài bản mới khi đang chạy profile.

Cài đặt, lịch sử và trạng thái chạy được lưu trong `tool.sqlite` ở thư mục data ngoài app. JSON cũ được tự chuyển một lần và giữ bản sao `state.pre-sqlite.json` tại vị trí cũ. Cập nhật chỉ thay app, không xóa database. Khi sao lưu, thoát app trước rồi copy toàn bộ thư mục data; không chỉ copy database trong lúc app đang chạy. Không dùng app 0.4.0 trở về trước để ghi vào dữ liệu đã chuyển SQLite.

## Kiểm tra kết nối GPM

Mở GPM, vào **Cài đặt chung → Kiểm tra / tìm GPM**. App thử địa chỉ đã nhập, rồi hai cổng phổ biến 9495 (Global/API v1) và 19995 (v4/API v3). Nếu tìm được địa chỉ khác, bấm **Lưu cho tất cả profile** để áp dụng. Với cổng tùy chỉnh, nhập địa chỉ đúng trong Cài đặt GPM trước khi kiểm tra. Dừng các profile đang chạy trước khi đổi địa chỉ GPM; đổi AI và nhịp chạy vẫn áp dụng từ bước tiếp theo.

Từ bản 0.4.3, cập nhật từ xa được bật cho repository công khai `vinitran/thread-gpm`. App hiện cảnh báo bản mới và nút kiểm tra/cài cập nhật. Bản 0.4.2 đã tắt cập nhật cần tải bản mới thủ công một lần. **Chạy thử · không đăng** kiểm tra Threads và AI, chỉ tạo bản xem trước, không gửi comment hoặc thả tim.
