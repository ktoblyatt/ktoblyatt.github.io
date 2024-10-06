
from outline.client import OutlineClient

client = OutlineClient(base_url="https://localhost:41511/secretpath")

new_key = client.new()

new_key.rename("VPNxVPN")

# set a data limit of 1GB
new_key.change_data_limit(999999999999999)

new_key.url("my key with 1PB limit")
# ss://example@example.com/?outline=1#my key with 1GB limit
